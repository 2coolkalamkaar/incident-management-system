const BATCH_SIZE = 2000;
const MAX_RETRIES = 3;
const STREAM_NAME = 'incident_signals';
const GROUP_NAME = 'ingestion_group';
const CONSUMER_NAME = 'worker_1';
const DLQ_STREAM = 'incident_signals_dlq';

/**
 * Utility for exponential backoff
 * @param {number} ms 
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wraps an async function in an exponential backoff retry loop.
 */
async function retryWithBackoff(operation, retries = MAX_RETRIES) {
  let attempt = 0;
  while (attempt < retries) {
    try {
      return await operation();
    } catch (error) {
      attempt++;
      if (attempt >= retries) throw error;
      const delayMs = Math.pow(2, attempt) * 100; // e.g., 200ms, 400ms...
      console.warn(`[Retry] Operation failed, retrying in ${delayMs}ms (Attempt ${attempt}/${retries}). Error: ${error.message}`);
      await sleep(delayMs);
    }
  }
}

/**
 * Start the async worker that consumes from Redis Streams continuously.
 */
async function startWorker(redisClient, pgPool, mongoCollection) {
  console.log(`[Worker] Starting async batch processor. Target batch size: ${BATCH_SIZE}`);

  // Ensure consumer group exists
  try {
    await redisClient.xgroup('CREATE', STREAM_NAME, GROUP_NAME, '0', 'MKSTREAM');
  } catch (err) {
    if (!err.message.includes('BUSYGROUP')) {
      console.error('[Worker] Error creating consumer group:', err);
    }
  }

  while (true) {
    try {
      // 1. Consume a batch of up to 500 messages, block for 2 seconds if none
      const result = await redisClient.xreadgroup(
        'GROUP', GROUP_NAME, CONSUMER_NAME,
        'COUNT', BATCH_SIZE,
        'BLOCK', 2000,
        'STREAMS', STREAM_NAME, '>'
      );

      if (!result) continue; // No messages within the block time

      const streamData = result[0][1]; // Array of [messageId, [field1, val1, ...]]
      if (streamData.length === 0) continue;

      console.log(`[Worker] Received batch of ${streamData.length} messages. Processing...`);
      await processBatch(redisClient, pgPool, mongoCollection, streamData);

    } catch (error) {
      console.error(`[Worker] Critical error in read loop:`, error.message);
      await sleep(1000); // Sleep briefly before trying again to prevent CPU spikes
    }
  }
}

/**
 * Step 1: Parse the batch
 * Step 2: Mongo bulk insert
 * Step 3: Postgres bulk upsert (idempotent)
 * Step 4: Retry / DLQ routing / ACK
 */
async function processBatch(redisClient, pgPool, mongoCollection, streamData) {
  const rawSignals = [];
  const workItemsMap = new Map(); // Use Map to deduplicate work_items by ID within the same batch
  const messageIds = [];

  // ==========================================
  // STEP 1: Parse the Batch
  // ==========================================
  for (const [messageId, fields] of streamData) {
    messageIds.push(messageId);
    
    // Redis streams fields are arrays: ['key1', 'val1', 'key2', 'val2']
    const payloadObj = {};
    for (let i = 0; i < fields.length; i += 2) {
      payloadObj[fields[i]] = fields[i + 1];
    }

    try {
      // Assume payloadObj contains a JSON string under the field 'data'
      const data = JSON.parse(payloadObj.data); 

      if (data.work_item_id) {
        // Prepare MongoDB raw signal
        rawSignals.push({
          work_item_id: data.work_item_id,
          component_id: data.component_id,
          severity_hint: data.severity_hint,
          timestamp: new Date(data.timestamp || Date.now()),
          payload: data.payload || {}
        });

        // Deduplicate Postgres work items (we only need to insert the work item once per UUID)
        if (!workItemsMap.has(data.work_item_id)) {
          workItemsMap.set(data.work_item_id, {
            id: data.work_item_id,
            component_id: data.component_id,
            severity: data.severity_hint || 'P3'
          });
        }
      }
    } catch (err) {
      console.warn(`[Worker] Failed to parse message ${messageId}, skipping format...`);
    }
  }

  try {
    // ==========================================
    // STEP 4a: Exponential Backoff Wrapper
    // ==========================================
    await retryWithBackoff(async () => {
      
      // ==========================================
      // STEP 2: MongoDB Bulk Insert
      // ==========================================
      if (rawSignals.length > 0) {
        // ordered: false allows Mongo to continue inserting remaining documents if one fails
        await mongoCollection.insertMany(rawSignals, { ordered: false });
      }

      // ==========================================
      // STEP 3: Postgres Bulk Upsert (Idempotent)
      // ==========================================
      const workItems = Array.from(workItemsMap.values());
      if (workItems.length > 0) {
        let valuesClause = [];
        let queryParams = [];
        let paramIndex = 1;

        workItems.forEach(item => {
          valuesClause.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
          queryParams.push(item.id, item.component_id, item.severity);
        });

        // Use ON CONFLICT DO NOTHING to ensure idempotency. 
        // If the work item ID already exists from a previous run or API call, ignore it.
        const pgQuery = `
          INSERT INTO work_items (id, component_id, severity)
          VALUES ${valuesClause.join(', ')}
          ON CONFLICT (id) DO NOTHING;
        `;

        await pgPool.query(pgQuery, queryParams);
      }
    });

    // ==========================================
    // STEP 4b: Acknowledge Messages on Success
    // ==========================================
    if (messageIds.length > 0) {
      await redisClient.xack(STREAM_NAME, GROUP_NAME, ...messageIds);
      console.log(`[Worker] ✅ Successfully processed, inserted, and ACKed batch of ${messageIds.length} messages.`);
      redisClient.publish('system_updates', JSON.stringify({ type: 'REFRESH_INCIDENTS' })).catch(err => console.error(err));
    }

  } catch (error) {
    // ==========================================
    // STEP 4c: DLQ Routing on Ultimate Failure
    // ==========================================
    console.error(`[Worker] ❌ Database operations failed after ${MAX_RETRIES} retries. Routing batch to DLQ.`);
    
    for (const [messageId, fields] of streamData) {
      try {
        // Push the original fields plus the error context to the Dead Letter Queue
        await redisClient.xadd(DLQ_STREAM, '*', ...fields, 'original_error', error.message);
      } catch (dlqErr) {
        console.error(`[Worker] FATAL: Failed to write to DLQ for message ${messageId}:`, dlqErr.message);
      }
    }

    // Acknowledge the original messages so they don't block the stream
    if (messageIds.length > 0) {
      await redisClient.xack(STREAM_NAME, GROUP_NAME, ...messageIds);
      console.log(`[Worker] ⚠️ ACKed ${messageIds.length} messages after routing to DLQ.`);
    }
  }
}

module.exports = { startWorker, processBatch };

// ==========================================
// EXECUTE WHEN RUN DIRECTLY
// ==========================================
if (require.main === module) {
  const { Pool } = require('pg');
  const { MongoClient } = require('mongodb');
  const Redis = require('ioredis');

  const pgPool = new Pool({ connectionString: process.env.POSTGRES_URL });
  const mongoClient = new MongoClient(process.env.MONGO_URL);
  const redisClient = new Redis(process.env.REDIS_URL);

  async function bootWorker() {
    await mongoClient.connect();
    const mongoCollection = mongoClient.db().collection('raw_signals');
    console.log('[Worker] 🔌 Connected to Databases');
    await startWorker(redisClient, pgPool, mongoCollection);
  }

  bootWorker().catch(err => {
    console.error('[Worker Boot Error]', err);
    process.exit(1);
  });
}
