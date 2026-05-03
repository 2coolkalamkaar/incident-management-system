/**
 * Custom Errors for State Machine
 */
class RCAMissingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RCAMissingError';
    this.statusCode = 400; // Will be mapped to HTTP 400 in the API layer
  }
}

class InvalidStateTransitionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidStateTransitionError';
    this.statusCode = 400;
  }
}

/**
 * Abstract Base Class for the State Pattern
 */
class WorkItemState {
  constructor(workItemId) {
    this.workItemId = workItemId;
  }

  get statusName() {
    throw new Error('Must be implemented by subclasses');
  }

  /**
   * @param {string} newStateName 
   * @param {Object} dbContext - A connected PostgreSQL client
   */
  async transitionTo(newStateName, dbContext) {
    throw new Error('Must be implemented by subclasses');
  }

  // Internal helper to update the row in Postgres
  async _updateStatusInDb(dbContext, newStatus) {
    const result = await dbContext.query(
      'UPDATE work_items SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [newStatus, this.workItemId]
    );
    return result.rows[0];
  }
}

/**
 * Concrete States
 */
class OpenState extends WorkItemState {
  get statusName() { return 'OPEN'; }

  async transitionTo(newStateName, dbContext) {
    if (newStateName !== 'INVESTIGATING') {
      throw new InvalidStateTransitionError(`Cannot transition from OPEN to ${newStateName}. Next valid state is INVESTIGATING.`);
    }
    
    await this._updateStatusInDb(dbContext, 'INVESTIGATING');
    return new InvestigatingState(this.workItemId);
  }
}

class InvestigatingState extends WorkItemState {
  get statusName() { return 'INVESTIGATING'; }

  async transitionTo(newStateName, dbContext) {
    if (newStateName === 'OPEN') {
      // Allow rollback if investigation was a false alarm
      await this._updateStatusInDb(dbContext, 'OPEN');
      return new OpenState(this.workItemId);
    }
    
    if (newStateName !== 'RESOLVED') {
      throw new InvalidStateTransitionError(`Cannot transition from INVESTIGATING to ${newStateName}. Next valid state is RESOLVED.`);
    }

    await this._updateStatusInDb(dbContext, 'RESOLVED');
    return new ResolvedState(this.workItemId);
  }
}

class ResolvedState extends WorkItemState {
  get statusName() { return 'RESOLVED'; }

  async transitionTo(newStateName, dbContext) {
    if (newStateName === 'INVESTIGATING') {
      // Re-open investigation if the fix failed
      await this._updateStatusInDb(dbContext, 'INVESTIGATING');
      return new InvestigatingState(this.workItemId);
    }
    
    if (newStateName !== 'CLOSED') {
      throw new InvalidStateTransitionError(`Cannot transition from RESOLVED to ${newStateName}.`);
    }

    // ==========================================
    // CRITICAL REQUIREMENT: Mandatory RCA Check
    // ==========================================
    await dbContext.query('BEGIN');
    
    try {
      // 1. Check for the RCA Record
      const rcaResult = await dbContext.query(
        'SELECT created_at FROM rca_records WHERE work_item_id = $1',
        [this.workItemId]
      );

      if (rcaResult.rows.length === 0) {
        throw new RCAMissingError(`Mandatory RCA is missing for Work Item ${this.workItemId}. Cannot close incident.`);
      }

      // 2. Fetch the original incident start time
      const wiResult = await dbContext.query(
        'SELECT created_at FROM work_items WHERE id = $1',
        [this.workItemId]
      );
      
      const startTime = wiResult.rows[0].created_at;
      const rcaTime = rcaResult.rows[0].created_at;

      // 3. Perform the state update
      await this._updateStatusInDb(dbContext, 'CLOSED');
      
      // 4. Commit the transaction
      await dbContext.query('COMMIT');

      // 5. Fire-and-forget: Trigger Async MTTR Calculation
      this._calculateAndLogMTTR(this.workItemId, startTime, rcaTime);

      return new ClosedState(this.workItemId);

    } catch (error) {
      await dbContext.query('ROLLBACK');
      throw error; // Re-throw so the HTTP router can catch it and return the 400
    }
  }

  // Private async method to handle MTTR reporting without blocking the HTTP response
  async _calculateAndLogMTTR(workItemId, startTime, rcaTime) {
    try {
      const startMs = new Date(startTime).getTime();
      const endMs = new Date(rcaTime).getTime();
      const mttrMinutes = (endMs - startMs) / (1000 * 60);
      
      // In a real SRE environment, you'd push this to Datadog, Prometheus, or a BI data warehouse
      console.log(`[Metrics] 📊 MTTR for Incident ${workItemId} calculated: ${mttrMinutes.toFixed(2)} minutes.`);
    } catch (err) {
      console.error(`[Metrics Error] Failed to calculate MTTR for ${workItemId}:`, err.message);
    }
  }
}

class ClosedState extends WorkItemState {
  get statusName() { return 'CLOSED'; }

  async transitionTo(newStateName, dbContext) {
    throw new InvalidStateTransitionError('Incident is strictly CLOSED. No further state transitions are allowed.');
  }
}

/**
 * Factory method to instantiate the correct State object 
 * based on the current database value.
 */
function hydrateWorkItemState(workItemId, currentDbStatus) {
  switch (currentDbStatus) {
    case 'OPEN': return new OpenState(workItemId);
    case 'INVESTIGATING': return new InvestigatingState(workItemId);
    case 'RESOLVED': return new ResolvedState(workItemId);
    case 'CLOSED': return new ClosedState(workItemId);
    default: throw new Error(`Unknown incident state encountered: ${currentDbStatus}`);
  }
}

module.exports = {
  WorkItemState,
  OpenState,
  InvestigatingState,
  ResolvedState,
  ClosedState,
  RCAMissingError,
  InvalidStateTransitionError,
  hydrateWorkItemState
};
