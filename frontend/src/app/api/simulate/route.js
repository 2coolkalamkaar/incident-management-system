import { NextResponse } from 'next/server';

export async function POST() {
  const components = [
    {
      component_id: `RDBMS_NODE_${Math.floor(Math.random() * 100)}`,
      severity_hint: "P0",
      payload: { error_code: "CONNECTION_REFUSED", latency_ms: 5000, message: "Failed to acquire connection from pool" }
    },
    {
      component_id: `CACHE_CLUSTER_${Math.floor(Math.random() * 100)}`,
      severity_hint: "P2",
      payload: { error_code: "EVICTION_RATE_HIGH", memory: "99%", message: "Simulated memory pressure" }
    },
    {
      component_id: `API_GATEWAY_EU_${Math.floor(Math.random() * 10)}`,
      severity_hint: "P1",
      payload: { error_code: "502_BAD_GATEWAY", throughput: "0 req/sec", message: "Upstream service timeout" }
    },
    {
      component_id: `MCP_INFERENCE_ROUTER`,
      severity_hint: "P0",
      payload: { error_code: "MODEL_TIMEOUT", queue_size: 4500, message: "LLM inference pool exhausted" }
    },
    {
      component_id: `STRIPE_WEBHOOK_WORKER`,
      severity_hint: "P1",
      payload: { error_code: "DLQ_FULL", message: "Failed to process payment webhooks" }
    }
  ];

  try {
    // Pick 2-3 random components to fail during this chaos run to provide variety
    const numToFail = Math.floor(Math.random() * 2) + 2; // 2 or 3
    const shuffled = components.sort(() => 0.5 - Math.random());
    const selectedComponents = shuffled.slice(0, numToFail);

    const allPromises = [];

    // For each failing component, fire a burst of 50 concurrent requests
    for (const comp of selectedComponents) {
      const promises = Array.from({ length: 50 }).map(() =>
        fetch('http://api:3000/api/v1/signals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(comp)
        }).catch(e => console.error(e))
      );
      allPromises.push(...promises);
    }

    await Promise.all(allPromises);

    return NextResponse.json({ 
      message: `Simulation triggered successfully. Fired ${allPromises.length} signals across ${numToFail} components!` 
    });
  } catch (error) {
    console.error("Simulation error", error);
    return NextResponse.json({ error: "Failed to run simulation" }, { status: 500 });
  }
}
