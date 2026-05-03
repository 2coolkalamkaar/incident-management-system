const { v4: uuidv4 } = require('uuid');

/**
 * Ingests an incoming signal, debouncing component failures to group them
 * into a single incident (Work Item).
 *
 * @param {Object} redisClient - Redis client (e.g., ioredis)
 * @param {Object} pgPool - PostgreSQL connection pool (e.g., pg)
 * @param {Object} mongoCollection - MongoDB collection (raw_signals)
 * @param {Object} signal - The incoming signal payload
 * @param {string} signal.component_id - The failing component ID
 * @param {string} signal.severity_hint - The severity level (e.g., 'P2')
 * @param {Object} signal.payload - The unstructured error data
 */
async function processIncomingSignal(redisClient, pgPool, mongoCollection, signal) {
  const { component_id, severity_hint, payload } = signal;

  if (!component_id) {
    throw new Error('component_id is required');
  }

  try {
    // 1. Generate a new UUIDv4 for a potential new incident
    const newUuid = uuidv4();
    const lockKey = `incident:lock:${component_id}`;

    // 2. Attempt to lock the component using Redis
    // NX: Only set the key if it does not already exist
    // EX 10: Set the specified expire time, in seconds (10s debounce window)
    const lockResult = await redisClient.set(lockKey, newUuid, 'NX', 'EX', 10);

    let activeWorkItemId;

    if (lockResult === 'OK') {
      // Lock acquired successfully - this is the first signal in a new burst
      activeWorkItemId = newUuid;

      // 3a. We have a new incident. We do NOT write to Postgres immediately.
      // We pass the new UUID into the stream so the batch worker can bulk insert it.
      console.log(`[New Incident] Assigned Work Item ${activeWorkItemId} for component ${component_id}`);
    } else {
      // Lock exists - this component is already failing and we are inside the 10s window
      // 3b. GET the existing UUID from Redis
      const existingUuid = await redisClient.get(lockKey);
      
      if (!existingUuid) {
        // Edge case: The key expired between our SET NX and GET. 
        // Fallback to the new UUID to avoid losing data.
        activeWorkItemId = newUuid;
      } else {
        activeWorkItemId = existingUuid;
      }
      
      console.log(`[Debounced] Routing signal to existing Work Item ${activeWorkItemId} for component ${component_id}`);
    }

    // 4. Push the event into the Redis Stream for the batch worker to process
    const streamPayload = {
      work_item_id: activeWorkItemId, // This bridges SQL and NoSQL
      component_id,
      severity_hint,
      timestamp: new Date().toISOString(),
      payload
    };

    // Use XADD to push to the 'incident_signals' stream. 
    // We stringify the payload into a 'data' field.
    await redisClient.xadd('incident_signals', '*', 'data', JSON.stringify(streamPayload));
    console.log(`[Stream] Queued signal for Work Item ${activeWorkItemId} to Redis Stream`);

  } catch (error) {
    console.error(`[Error] Failed to process signal for component ${component_id}:`, error.message);
    // Depending on the architecture, you might want to push this to a Dead Letter Queue (DLQ) here
    throw error;
  }
}

module.exports = { processIncomingSignal };
