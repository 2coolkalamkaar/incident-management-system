import { NextResponse } from 'next/server';

export async function POST() {
  const dbPayload = {
    component_id: `RDBMS_NODE_${Math.floor(Math.random() * 100)}`,
    severity_hint: "P0",
    payload: { error_code: "CONNECTION_REFUSED", latency_ms: 5000, message: "Simulated chaos event" }
  };
  
  const cachePayload = {
    component_id: `CACHE_CLUSTER_${Math.floor(Math.random() * 100)}`,
    severity_hint: "P2",
    payload: { error_code: "EVICTION_RATE_HIGH", memory: "99%", message: "Simulated memory pressure" }
  };

  try {
    // Fire 50 concurrent requests for DB to simulate an outage burst
    const dbPromises = Array.from({ length: 50 }).map(() =>
      fetch('http://api:3000/api/v1/signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dbPayload)
      })
    );

    // Fire 50 concurrent requests for Cache
    const cachePromises = Array.from({ length: 50 }).map(() =>
      fetch('http://api:3000/api/v1/signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cachePayload)
      })
    );

    await Promise.all([...dbPromises, ...cachePromises]);

    return NextResponse.json({ message: "Simulation triggered successfully. 100 signals fired to backend!" });
  } catch (error) {
    console.error("Simulation error", error);
    return NextResponse.json({ error: "Failed to run simulation" }, { status: 500 });
  }
}
