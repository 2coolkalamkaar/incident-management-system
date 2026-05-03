/**
 * Interface-like base class for Alert Strategies
 */
class AlertStrategy {
  /**
   * @param {Object} workItem
   * @param {string} workItem.id
   * @param {string} workItem.component_id
   * @param {string} workItem.severity
   */
  async triggerAlert(workItem) {
    throw new Error('triggerAlert must be implemented by concrete strategies');
  }
}

/**
 * Concrete Strategy: P0 Database Alerts (Simulates PagerDuty)
 */
class P0DatabaseStrategy extends AlertStrategy {
  async triggerAlert(workItem) {
    console.log(`[PagerDuty] 🚨 CRITICAL P0 DATABASE ALERT Triggered!`);
    console.log(`[PagerDuty] Waking up on-call DBA for WorkItem: ${workItem.id} | Component: ${workItem.component_id}`);
    
    // Simulate an HTTP call to the PagerDuty API
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log(`[PagerDuty] Incident escalated successfully.`);
  }
}

/**
 * Concrete Strategy: P2 Cache Alerts (Simulates Slack Webhook)
 */
class P2CacheStrategy extends AlertStrategy {
  async triggerAlert(workItem) {
    console.log(`[Slack] 🟡 P2 CACHE ALERT: Component ${workItem.component_id} is degrading.`);
    console.log(`[Slack] Posting message to #eng-cache-alerts for WorkItem: ${workItem.id}`);
    
    // Simulate an HTTP call to a Slack Webhook
    await new Promise(resolve => setTimeout(resolve, 200));
    console.log(`[Slack] Message posted successfully.`);
  }
}

/**
 * Concrete Strategy: Default Fallback Alert (Email)
 */
class DefaultEmailStrategy extends AlertStrategy {
  async triggerAlert(workItem) {
    console.log(`[Email] ✉️ UNKNOWN COMPONENT ALERT: ${workItem.component_id} (WorkItem: ${workItem.id})`);
    console.log(`[Email] Sending standard email to sre-triage@company.com for manual review.`);
    
    // Simulate SMTP dispatch
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/**
 * Alert Manager (Context/Factory) that routes to the correct strategy
 */
class AlertManager {
  constructor() {
    this.defaultStrategy = new DefaultEmailStrategy();
    
    // Registry mapping component prefixes to specific strategies
    this.registry = {
      'RDBMS_': new P0DatabaseStrategy(),
      'CACHE_': new P2CacheStrategy(),
      // Add more prefix mappings here as the system grows (e.g., 'AUTH_' -> OktaStrategy)
    };
  }

  /**
   * Dispatches the alert based on the component prefix.
   * This is designed to be called synchronously by the main thread. It wraps
   * the async strategy execution in setImmediate to ensure it runs in the background
   * and does NOT block the main HTTP request/response cycle.
   * 
   * @param {Object} workItem 
   */
  dispatchAlert(workItem) {
    // Wrap the async execution so it doesn't block the event loop
    setImmediate(async () => {
      try {
        const strategy = this._resolveStrategy(workItem.component_id);
        await strategy.triggerAlert(workItem);
      } catch (error) {
        // Fallback catch block for the background process so it doesn't crash the server
        console.error(`[AlertManager Error] Failed to dispatch alert for WorkItem ${workItem.id}:`, error.message);
      }
    });
  }

  /**
   * Internal helper to match a component_id to a registered strategy
   * @param {string} componentId e.g., 'CACHE_CLUSTER_01'
   * @returns {AlertStrategy}
   */
  _resolveStrategy(componentId) {
    if (!componentId) return this.defaultStrategy;

    for (const [prefix, strategy] of Object.entries(this.registry)) {
      if (componentId.startsWith(prefix)) {
        return strategy;
      }
    }
    
    // Provide a robust default strategy if the component prefix is unknown
    return this.defaultStrategy;
  }
}

// Export a singleton instance of the manager for use across the application
const alertManagerInstance = new AlertManager();

module.exports = {
  AlertStrategy,
  P0DatabaseStrategy,
  P2CacheStrategy,
  DefaultEmailStrategy,
  AlertManager,
  alertManager: alertManagerInstance
};
