import requests
import concurrent.futures
import time
import json
import random

API_URL = "http://localhost:3000/api/v1/signals"

components = [
    {
        "component_id": "RDBMS_MAIN_01",
        "severity_hint": "P0",
        "payload": { "error_code": "CONNECTION_REFUSED", "latency_ms": 5000, "message": "Failed to acquire connection from pool" }
    },
    {
        "component_id": "MCP_HOST_EAST",
        "severity_hint": "P1",
        "payload": { "error_code": "PROCESS_CRASH", "memory_usage": "99%", "message": "OOM Killer triggered on MCP host" }
    },
    {
        "component_id": "API_GATEWAY_EU_02",
        "severity_hint": "P1",
        "payload": { "error_code": "502_BAD_GATEWAY", "throughput": "0 req/sec", "message": "Upstream service timeout" }
    },
    {
        "component_id": "STRIPE_WEBHOOK_WORKER",
        "severity_hint": "P1",
        "payload": { "error_code": "DLQ_FULL", "message": "Failed to process payment webhooks" }
    }
]

def send_signal(payload):
    try:
        response = requests.post(
            API_URL, 
            json=payload, 
            headers={"Content-Type": "application/json"},
            timeout=2
        )
        return response.status_code
    except requests.exceptions.RequestException as e:
        return "TIMEOUT/ERROR"

def blast_api(payload, num_requests=100, label=""):
    print(f"\n🚀 Initiating {label} - Firing {num_requests} concurrent signals...")
    start_time = time.time()
    
    status_codes = {}
    
    # Fire requests concurrently to trigger potential race conditions
    with concurrent.futures.ThreadPoolExecutor(max_workers=50) as executor:
        futures = [executor.submit(send_signal, payload) for _ in range(num_requests)]
        for future in concurrent.futures.as_completed(futures):
            code = future.result()
            status_codes[code] = status_codes.get(code, 0) + 1
            
    duration = time.time() - start_time
    print(f"✅ Completed in {duration:.2f} seconds.")
    print(f"📊 Results Breakdown:")
    for code, count in status_codes.items():
        print(f"   HTTP {code}: {count} requests")
        
    if status_codes.get(429):
        print("   🛡️ Rate Limiter Active: Dropped excess requests gracefully.")

if __name__ == "__main__":
    print("--- IMS Chaos Testing Script ---")
    
    # Pick 2-3 random components to fail
    num_to_fail = random.randint(2, 3)
    failing_components = random.sample(components, num_to_fail)
    
    for comp in failing_components:
        label = f"{comp['component_id']} Cascading Failure Simulation"
        blast_api(comp, num_requests=50, label=label)
        time.sleep(1)
    
    print("\n💡 Verification Step:")
    print(f"Check your database. You should have exactly {num_to_fail} Work Items in PostgreSQL.")
    print(f"You should have ~{num_to_fail * 50} raw signal documents in MongoDB linked to those Work Items.")