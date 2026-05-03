import requests
import concurrent.futures
import time
import json

API_URL = "http://localhost:3000/api/v1/signals"

# Scenario 1: Massive DB Outage (Tests Debouncing)
db_outage_payload = {
    "component_id": "RDBMS_MAIN_01",
    "severity_hint": "P0",
    "payload": {
        "error_code": "CONNECTION_REFUSED",
        "latency_ms": 5000,
        "message": "Failed to acquire connection from pool"
    }
}

# Scenario 2: Downstream MCP Failure (Tests distinct routing/alerting)
mcp_failure_payload = {
    "component_id": "MCP_HOST_EAST",
    "severity_hint": "P1",
    "payload": {
        "error_code": "PROCESS_CRASH",
        "memory_usage": "99%",
        "message": "OOM Killer triggered on MCP host"
    }
}

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
    
    # 1. Simulate the Database Crash (100 signals instantly)
    blast_api(db_outage_payload, num_requests=100, label="RDBMS Outage Simulation")
    
    # Brief pause to let the queue process
    time.sleep(2)
    
    # 2. Simulate the cascading MCP failure (50 signals)
    blast_api(mcp_failure_payload, num_requests=50, label="MCP Cascading Failure Simulation")
    
    print("\n💡 Verification Step:")
    print("Check your database. You should have exactly TWO Work Items in PostgreSQL.")
    print("You should have ~150 raw signal documents in MongoDB linked to those two Work Items.")