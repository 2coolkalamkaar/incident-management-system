const express = require('express');
const { Pool } = require('pg');
const { MongoClient } = require('mongodb');
const Redis = require('ioredis');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Import our SRE business logic
const { processIncomingSignal } = require('./ingestion');
const { hydrateWorkItemState, InvalidStateTransitionError, RCAMissingError } = require('./stateMachine');
const { alertManager } = require('./alertStrategy');

const app = express();
app.use(express.json());

// Initialize Database Connections using Docker Compose environment variables
const pgPool = new Pool({ connectionString: process.env.POSTGRES_URL });
const mongoClient = new MongoClient(process.env.MONGO_URL);
const redisClient = new Redis(process.env.REDIS_URL);

let mongoCollection;

async function connectDatabases() {
  await mongoClient.connect();
  mongoCollection = mongoClient.db().collection('raw_signals');
  await pgPool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
  // Create timeline table if it doesn't exist (idempotent)
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS incident_timeline (
      id SERIAL PRIMARY KEY,
      work_item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      event_type VARCHAR(50) NOT NULL,
      description TEXT NOT NULL,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
  await pgPool.query('CREATE INDEX IF NOT EXISTS idx_timeline_work_item ON incident_timeline(work_item_id);');
  console.log('[Server] 🔌 Successfully connected to PostgreSQL, MongoDB, and Redis.');
}

/**
 * Helper: Insert a timeline event for an incident.
 */
async function logTimelineEvent(workItemId, eventType, description, metadata = {}) {
  try {
    await pgPool.query(
      'INSERT INTO incident_timeline (work_item_id, event_type, description, metadata) VALUES ($1, $2, $3, $4)',
      [workItemId, eventType, description, JSON.stringify(metadata)]
    );
  } catch (err) {
    console.warn('[Timeline] Failed to log event:', err.message);
  }
}

// ==========================================
// ROUTES
// ==========================================

/**
 * POST /api/v1/signals
 * Ingests high-throughput signals, debounces them, and queues them for the batch worker.
 */
app.post('/api/v1/signals', async (req, res) => {
  try {
    const signal = req.body;

    // 1. Debounce and push to Redis Streams
    await processIncomingSignal(redisClient, pgPool, mongoCollection, signal);

    // 2. Dispatch Alerts based on component Strategy
    alertManager.dispatchAlert({
      id: signal.work_item_id || 'pending-uuid',
      component_id: signal.component_id,
      severity: signal.severity_hint
    });

    res.status(202).json({ message: 'Signal accepted and queued for processing.' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/v1/incidents/:id/state
 * Moves an incident through its lifecycle (OPEN -> INVESTIGATING -> RESOLVED -> CLOSED)
 */
app.post('/api/v1/incidents/:id/state', async (req, res) => {
  const { id } = req.params;
  const { newState } = req.body;

  try {
    // 1. Fetch current state
    const result = await pgPool.query('SELECT status FROM work_items WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    // 2. Hydrate the State Machine pattern
    const currentStatus = result.rows[0].status;
    const incidentState = hydrateWorkItemState(id, currentStatus);

    // 3. Attempt Transition (This handles the transaction and RCA validation for 'CLOSED')
    const updatedState = await incidentState.transitionTo(newState, pgPool);

    // 4. Log to Incident Timeline
    const icons = { INVESTIGATING: '🔍', RESOLVED: '✅', CLOSED: '🔒' };
    await logTimelineEvent(id, 'STATE_CHANGE', 
      `${icons[newState] || '🔄'} State changed from ${currentStatus} to ${newState}`,
      { from: currentStatus, to: newState }
    );

    res.status(200).json({
      message: 'State transition successful',
      newStatus: updatedState.statusName
    });

  } catch (error) {
    // Map our custom State Machine errors to HTTP 400 Bad Request
    if (error instanceof InvalidStateTransitionError || error instanceof RCAMissingError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('[Server Error]', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * POST /api/v1/incidents/:id/rca
 * Utility route to create an RCA so an incident can be closed.
 */
app.post('/api/v1/incidents/:id/rca', async (req, res) => {
  const { id } = req.params;
  const { root_cause_category, fix_applied, prevention_steps } = req.body;

  try {
    const query = `
      INSERT INTO rca_records (work_item_id, root_cause_category, fix_applied, prevention_steps)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;
    const result = await pgPool.query(query, [id, root_cause_category, fix_applied, prevention_steps]);

    // Log to Incident Timeline
    await logTimelineEvent(id, 'RCA_SUBMITTED', 
      `📝 Root Cause Analysis submitted: "${root_cause_category}"`,
      { root_cause_category, fix_applied }
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') { // Postgres unique violation code
      return res.status(409).json({ error: 'RCA already exists for this incident.' });
    }
    console.error('[RCA Error]', error);
    res.status(500).json({ error: 'Failed to create RCA' });
  }
});

/**
 * POST /api/v1/incidents/:id/auto-rca
 * Auto-generates Root Cause Analysis using Gemini AI based on raw telemetry.
 */
app.post('/api/v1/incidents/:id/auto-rca', async (req, res) => {
  const { id } = req.params;
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    // 1. Fetch raw signals
    const signals = await mongoCollection.find({ work_item_id: id })
      .sort({ timestamp: -1 })
      .limit(20) // Only send recent 20 to fit in prompt nicely
      .toArray();

    if (signals.length === 0) {
      return res.status(400).json({ error: "No raw telemetry found to analyze." });
    }

    // 2. Initialize Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

    // 3. Build Prompt
    const prompt = `
    You are an expert Site Reliability Engineer (SRE).
    Analyze the following JSON telemetry logs from an ongoing incident and generate a Root Cause Analysis (RCA).
    
    Telemetry:
    ${JSON.stringify(signals.map(s => s.payload), null, 2)}
    
    Respond EXACTLY with a raw JSON object (no markdown formatting, no backticks) containing:
    {
      "root_cause_category": "Short 2-3 word category (e.g., Database Connection Pool)",
      "fix_applied": "A brief sentence describing the immediate fix.",
      "prevention_steps": "A brief sentence describing how to prevent it next time."
    }
    `;

    // 4. Call Gemini
    const result = await model.generateContent(prompt);
    let text = result.response.text();
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const rca = JSON.parse(text);

    // Log to Incident Timeline
    await logTimelineEvent(id, 'AI_RCA_GENERATED', 
      `✨ AI Generated RCA via Gemini 2.5 Pro: "${rca.root_cause_category}"`,
      { model: 'gemini-2.5-pro', root_cause_category: rca.root_cause_category }
    );

    res.status(200).json(rca);
  } catch (error) {
    console.error('[Auto-RCA Error]', error);
    res.status(500).json({ error: 'Failed to generate RCA from AI' });
  }
});

/**
 * GET /api/v1/incidents/:id/timeline
 * Fetches the chronological audit log for an incident.
 */
app.get('/api/v1/incidents/:id/timeline', async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const result = await pgPool.query(
      'SELECT * FROM incident_timeline WHERE work_item_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('[Timeline Fetch Error]', error);
    res.status(500).json({ error: 'Failed to fetch timeline' });
  }
});

/**
 * GET /api/v1/incidents
 * Fetches the active work items to populate the SRE dashboard.
 */
app.get('/api/v1/incidents', async (req, res) => {
  try {
    // Enable CORS for local development
    res.setHeader('Access-Control-Allow-Origin', '*');

    const result = await pgPool.query('SELECT * FROM work_items ORDER BY created_at DESC LIMIT 50');
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('[Fetch Error]', error);
    res.status(500).json({ error: 'Failed to fetch incidents' });
  }
});

/**
 * GET /api/v1/incidents/:id/signals
 * Fetches raw signals from MongoDB for a specific incident to display in the UI.
 */
app.get('/api/v1/incidents/:id/signals', async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const signals = await mongoCollection.find({ work_item_id: req.params.id })
      .sort({ timestamp: -1 })
      .limit(100)
      .toArray();
    res.status(200).json(signals);
  } catch (error) {
    console.error('[Mongo Fetch Error]', error);
    res.status(500).json({ error: 'Failed to fetch signals' });
  }
});

/**
 * GET /api/v1/incidents/:id/similar
 * Mocked RAG search using pg_trgm text similarity to find historical closed incidents.
 */
app.get('/api/v1/incidents/:id/similar', async (req, res) => {
  const { id } = req.params;
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');

    // First get the current incident's component
    const current = await pgPool.query('SELECT component_id FROM work_items WHERE id = $1', [id]);
    if (current.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });

    const componentId = current.rows[0].component_id;

    // Search for CLOSED incidents with similar component_id using trigram similarity
    const query = `
      SELECT 
        w.id, w.component_id, w.severity, 
        r.root_cause_category, r.fix_applied, r.prevention_steps,
        ROUND(similarity(w.component_id, $1)::numeric * 100, 1) as sim_score
      FROM work_items w
      JOIN rca_records r ON w.id = r.work_item_id
      WHERE w.status = 'CLOSED' 
        AND w.id != $2
        AND similarity(w.component_id, $1) > 0.1
      ORDER BY sim_score DESC
      LIMIT 3;
    `;
    const result = await pgPool.query(query, [componentId, id]);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('[Similarity Fetch Error]', error);
    res.status(500).json({ error: 'Failed to calculate similarity' });
  }
});

/**
 * GET /api/v1/analytics/mttr
 * Calculates the Mean Time To Recovery (MTTR) for CLOSED incidents.
 */
app.get('/api/v1/analytics/mttr', async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const query = `
      SELECT 
        COUNT(*) as total_count,
        COUNT(*) FILTER (WHERE status IN ('OPEN', 'INVESTIGATING', 'RESOLVED')) as active_count,
        COUNT(*) FILTER (WHERE status = 'CLOSED') as closed_count,
        COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) FILTER (WHERE status = 'CLOSED'), 0) as avg_mttr_seconds
      FROM work_items;
    `;
    const result = await pgPool.query(query);
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('[MTTR Fetch Error]', error);
    res.status(500).json({ error: 'Failed to calculate MTTR' });
  }
});

/**
 * GET /api/v1/stream
 * Server-Sent Events (SSE) for Real-Time UI updates.
 */
app.get('/api/v1/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  // Create a dedicated redis subscriber for this client
  const subscriber = new Redis(process.env.REDIS_URL);

  subscriber.subscribe('system_updates', (err) => {
    if (err) console.error("Failed to subscribe", err);
  });

  subscriber.on('message', async (channel, message) => {
    const data = JSON.parse(message);
    if (data.type === 'REFRESH_INCIDENTS') {
      res.write(`event: refresh\ndata: {}\n\n`);
    } else if (data.type === 'DEBOUNCE_INCREMENT') {
      const count = await redisClient.get('metrics:signals_dropped');
      res.write(`event: debounce\ndata: ${JSON.stringify({ count })}\n\n`);
    }
  });

  // Send initial metrics on connection
  redisClient.get('metrics:signals_dropped').then(count => {
    res.write(`event: debounce\ndata: ${JSON.stringify({ count: count || 0 })}\n\n`);
  });

  // Keep-alive heartbeat
  const interval = setInterval(() => {
    res.write(`:\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(interval);
    subscriber.quit();
  });
});

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 3000;
connectDatabases().then(() => {
  app.listen(PORT, () => {
    console.log(`[Server] 🚀 API Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('[Server] FATAL: Failed to connect to databases on boot.', err);
  process.exit(1);
});
