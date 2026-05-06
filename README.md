#  Incident Management Command Center (IMC)

##  System Architecture

```
                          ┌─────────────────────────────────────────────────┐
                          │              Next.js Frontend (Port 3001)        │
                          │  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
                          │  │ Live     │  │ Realtime │  │  Incident    │  │
                          │  │ Graph    │  │ SSE Feed │  │  Detail Pane │  │
                          │  └──────────┘  └──────────┘  └──────────────┘  │
                          └────────────────────┬────────────────────────────┘
                                               │ HTTP / SSE (Proxy)
                                               ▼
                          ┌─────────────────────────────────────────────────┐
                          │              Express API (Port 3000)             │
                          │  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
                          │  │ Ingestion│  │ SSE /    │  │  State       │  │
                          │  │ + Debounce│  │ Pub/Sub  │  │  Machine     │  │
                          │  └──────────┘  └──────────┘  └──────────────┘  │
                          └──────┬──────────────┬──────────────────────────┘
                                 │              │ Pub/Sub
                    ┌────────────▼──┐    ┌──────▼───────┐
                    │  Redis 7      │    │  Redis 7     │
                    │  Streams      │    │  Pub/Sub     │
                    │  (Queue)      │    │  Channel     │
                    └────────────┬──┘    └──────────────┘
                                 │
                    ┌────────────▼──────────────────────┐
                    │      Async Batch Worker (Node.js)   │
                    │  • Consumes in batches of 500      │
                    │  • Exponential Backoff Retry       │
                    │  • DLQ on ultimate failure         │
                    └─────────┬─────────────┬───────────┘
                              │             │
               ┌──────────────▼──┐   ┌──────▼──────────────┐
               │  PostgreSQL 15   │   │  MongoDB 6           │
               │  (Work Items,    │   │  (Raw Signals /      │
               │   RCA Records,   │   │   Data Lake)         │
               │   State Machine) │   └─────────────────────┘
               └─────────────────┘
```

---

## Key Features

### Incident Lifecycle (State Machine)

Strict transition rules are enforced server-side:

```
OPEN ──► INVESTIGATING ──► RESOLVED ──► CLOSED
  │                             │
  └──── ❌ Direct skip forbidden │
                                │
                                └──► Requires RCA record in DB (transactional check)
                                     Triggers async MTTR calculation on success
```

**Business Rule:** A `RESOLVED` → `CLOSED` transition opens a **database transaction**, queries the `rca_records` table, aborts with `HTTP 400` if no RCA exists, and only commits on valid RCA presence. This prevents incidents from being silently swept under the rug.

---

### Signal Ingestion & Debouncing

The ingestion pipeline is designed to survive a **DDoS-scale alert storm**:

1. A signal arrives at `POST /api/v1/signals`.
2. A `SET NX` Redis lock is attempted with a **10-second TTL** per `component_id`.
3. **If lock acquired (first occurrence):** A `work_item` is created in PostgreSQL and the signal is queued to the Redis Stream.
4. **If lock exists (duplicate during storm):** Only the raw signal is queued. No new Postgres row. The `metrics:signals_dropped` counter is incremented and pushed to the SSE bus in real-time.

This means **100 concurrent failures from the same component produce exactly 1 incident ticket** — saving thousands of unnecessary database writes.

---

### Async Batch Worker

The worker runs as a **separate containerized process**, consuming from the Redis Stream:

```
Read Batch (up to 2000 messages)
       │
       ├─► Parse: separate MongoDB signals vs Postgres work_items
       │
       ├─► Step 1: MongoDB bulkInsert (ordered: false for resilience)
       │
       ├─► Step 2: Postgres bulk upsert (ON CONFLICT DO NOTHING → idempotent)
       │
       ├─► Success? → ACK all messages + publish REFRESH_INCIDENTS to Pub/Sub
       │
       └─► Failure? → Exponential Backoff (x3) → Route to DLQ → ACK originals
```

Throughput is logged per-batch. The DLQ prevents a single bad batch from blocking the entire stream.

---

### Real-Time Streaming (SSE + Redis Pub/Sub)

The UI **never polls**. Instead:

1. Browser opens a persistent `EventSource` connection to `/api/stream`.
2. The Next.js proxy passes it through to Express.
3. Express creates a **dedicated Redis subscriber** per client.
4. When the Batch Worker finishes a write, it publishes to `system_updates`.
5. Express pushes an `event: refresh` packet down the open connection.
6. The React frontend updates the incident grid and stat counters **instantly**, with zero re-renders triggered by timers.

---

### AI-Augmented Incident Resolution

This system leverages **Google Gemini 2.5 Pro** to reduce MTTR (Mean Time To Recovery) through two advanced patterns:

1. **AI Copilot (RAG):** When an incident occurs, the system uses `pg_trgm` (Postgres Trigram Similarity) to search the "Historical Data Lake" for similar past incidents and their resolutions.
2. **Auto-Generate RCA:** Instead of manual entry, an engineer can click one button to have Gemini analyze the raw MongoDB telemetry logs and generate a structured Root Cause Analysis automatically.
3. **Incident Timeline (Audit Log):** Every lifecycle action is persisted to a chronological audit trail with JSONB metadata, enabling full post-mortem forensics.

```
Incident created (42 signals detected)                    14:01:23
State changed from OPEN to INVESTIGATING                 14:03:11
AI Generated RCA via Gemini 2.5 Pro: "Connection Pool"    14:05:44
Root Cause Analysis submitted: "Database Exhaustion"      14:06:02
State changed from INVESTIGATING to RESOLVED              14:06:15
State changed from RESOLVED to CLOSED                    14:06:28
```

---

###  Frontend Dashboard

Built with **Next.js 15 App Router** using glassmorphic dark-mode design.

| Component | Description |
|---|---|
| **Real-Time Concurrency Graph** | Live SVG step-chart showing debounced signals/sec |
| **Stats Bar** | Total / Active / Closed incidents + Avg MTTR, all live-updating |
| **Incident Grid** | Cards color-coded by severity (P0 → P3) with pulsing P0 animation |
| **Distributed Trace Map** | Visual node graph showing upstream service blast radius |
| **AI Copilot (RAG)** | Instantly surfaces historical fixes from similar past incidents |
| **Incident Timeline** | Chronological audit log of every lifecycle event with glowing dots and timestamps |
| **Lifecycle Action Bar** | One-click state transitions enforced by the backend State Machine |
| **RCA Form** | Inline Root Cause Analysis submission — required before incident closure |
| **Raw Telemetry Pane** | Full MongoDB signal payloads rendered as a log stream |
| **Chaos Simulation Button** | Fires randomized concurrent signals to stress-test the pipeline |

---

## Getting Started

### Prerequisites
- Docker & Docker Compose
- Python 3 (for chaos testing)

### 1. Start the entire stack

```bash
git clone <your-repo-url>
cd IMC
docker-compose up --build -d
```

All 6 services will start with health-check dependencies:
- `imc-postgres` → PostgreSQL 15
- `imc-mongodb` → MongoDB 6
- `imc-redis` → Redis 7
- `imc-api` → Express API (`:3000`)
- `imc-worker` → Async Batch Worker
- `imc-frontend` → Next.js Dashboard (`:3001`)

### 2. Open the Dashboard

```
http://localhost:3001
```

### 3. Run the Chaos Simulation

Either click ** RUN CHAOS SIMULATION** in the UI, or run the Python script directly:

```bash
pip3 install requests
python3 mock.py
```

This fires **150 concurrent HTTP requests** (100 RDBMS failures + 50 MCP failures) to stress-test the debouncing pipeline. You should see exactly **2 work items** created in PostgreSQL and ~150 raw signals stored in MongoDB.

---

##  Database Schema

### PostgreSQL — `work_items`
```sql
CREATE TABLE work_items (
  id           UUID PRIMARY KEY,
  component_id VARCHAR(255) NOT NULL,
  severity     VARCHAR(10)  NOT NULL,   -- P0, P1, P2, P3
  status       VARCHAR(20)  NOT NULL DEFAULT 'OPEN',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### PostgreSQL — `rca_records`
```sql
CREATE TABLE rca_records (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id        UUID REFERENCES work_items(id),
  root_cause_category VARCHAR(255),
  fix_applied         TEXT,
  prevention_steps    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### MongoDB — `raw_signals`
```json
{
  "work_item_id":   "UUID",
  "component_id":   "RDBMS_NODE_42",
  "severity_hint":  "P0",
  "timestamp":      "ISODate",
  "payload":        { "error_code": "CONNECTION_REFUSED", "latency_ms": 5000 }
}
```

---

## 📡 API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/signals` | Ingest a raw telemetry signal |
| `GET` | `/api/v1/incidents` | List all work items from PostgreSQL |
| `GET` | `/api/v1/incidents/:id/signals` | Fetch raw MongoDB logs for an incident |
| `GET` | `/api/v1/incidents/:id/similar` | **RAG:** Search historical RCA records using trigram similarity |
| `GET` | `/api/v1/incidents/:id/timeline` | Fetch chronological audit log for an incident |
| `POST` | `/api/v1/incidents/:id/state` | Trigger a state machine transition |
| `POST` | `/api/v1/incidents/:id/rca` | Submit a Root Cause Analysis record |
| `GET` | `/api/v1/analytics/mttr` | Get MTTR analytics aggregation |
| `GET` | `/api/v1/stream` | SSE endpoint for real-time UI push events |

---

##  Tech Stack

```
Backend      Node.js 18, Express.js
Frontend     Next.js 15 (App Router), React 18
Databases    PostgreSQL 15, MongoDB 6, Redis 7
Messaging    Redis Streams (queue), Redis Pub/Sub (real-time events)
AI Search    PostgreSQL pg_trgm (mocking vector similarity)
AI LLM       Google Gemini 2.5 Pro (RCA generation)
Containers   Docker, Docker Compose
Chaos Test   Python 3, concurrent.futures
```

---

##  Design Patterns Used

- **RAG (Retrieval-Augmented Generation)** — Uses Postgres `pg_trgm` text similarity to query past RCA records and suggest fixes for active incidents based on component signatures.
- **State Pattern** — `OpenState`, `InvestigatingState`, `ResolvedState`, `ClosedState` classes with strict transition enforcement and transactional RCA validation.
- **Strategy Pattern** — `AlertStrategy` interface with `P0DatabaseStrategy` (PagerDuty sim) and `P2CacheStrategy` (Slack sim) concrete implementations routed via `AlertFactory`.
- **Circuit Breaker** — Redis `SET NX` debouncing prevents duplicate incident creation during alert storms.
- **Idempotency** — `ON CONFLICT DO NOTHING` in PostgreSQL and `ordered: false` in MongoDB ensure safe re-processing.
- **Dead Letter Queue** — Failed batches are routed to `incident_signals_dlq` after 3 exponential backoff retries.
- **BFF (Backend For Frontend)** — Next.js API routes act as a proxy layer, solving internal Docker DNS resolution and eliminating CORS issues.
- **Push Architecture** — Redis Pub/Sub + Server-Sent Events replaces polling for sub-second UI latency.
- **Event Sourcing (Audit Log)** — Every incident lifecycle action is persisted to an `incident_timeline` table with JSONB metadata, enabling full post-mortem forensics.

---

## Project Structure

```
IMC/
├── api/
│   ├── server.js          # Express API, routes, SSE endpoint
│   ├── ingestion.js       # Signal ingestion + Redis debounce logic
│   ├── batchWorker.js     # Async consumer: batching, retry, DLQ
│   ├── stateMachine.js    # State pattern: lifecycle + RCA transaction
│   └── alertStrategy.js   # Strategy pattern: P0/P2 alert routing
├── frontend/
│   └── src/app/
│       ├── page.js        # Main dashboard with real-time graph
│       └── api/           # Next.js proxy routes (BFF layer)
│           ├── incidents/
│           ├── analytics/
│           ├── simulate/
│           └── stream/
├── db/postgres/
│   └── schema.sql         # PostgreSQL schema definitions
├── mock.py                # Chaos Engineering test script
└── docker-compose.yml     # Full 6-service orchestration
```

---

