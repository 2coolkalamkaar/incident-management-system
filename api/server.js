const express = require('express');
const { Pool } = require('pg');
const { MongoClient } = require('mongodb');
const Redis = require('ioredis');

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
  console.log('[Server] 🔌 Successfully connected to PostgreSQL, MongoDB, and Redis.');
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
 * GET /api/v1/analytics/mttr
 * Calculates the Mean Time To Recovery (MTTR) for CLOSED incidents.
 */
app.get('/api/v1/analytics/mttr', async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const query = `
      SELECT 
        COUNT(id) as closed_count,
        COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - created_at))), 0) as avg_mttr_seconds
      FROM work_items 
      WHERE status = 'CLOSED';
    `;
    const result = await pgPool.query(query);
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('[MTTR Fetch Error]', error);
    res.status(500).json({ error: 'Failed to calculate MTTR' });
  }
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
