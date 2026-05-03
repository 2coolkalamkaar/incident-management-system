# Step 2: Database Schema Design

## 1. PostgreSQL Schema (The Source of Truth)

We require strict relational integrity for core incident data.

### Tables

**`work_items`**
Tracks the state machine of an incident.
- Uses ENUMs for status and severity to enforce constraints.
- `id`: UUID (Primary Key).
- `status`: Indexed for fast querying of active incidents.

**`rca_records`**
Handles the mandatory Root Cause Analysis for closed incidents.
- `work_item_id`: 1-to-1 relationship with `work_items`, with cascading deletes.

*SRE Note:* State transition logic should strictly enforce that a `work_item` cannot transition to `CLOSED` unless a corresponding `rca_record` exists.

## 2. MongoDB Schema (The Data Lake / Audit Log)

MongoDB acts as a high-throughput, schema-less dumping ground for raw signals.

### Collection: `raw_signals`
Absorbs potentially high-volume signals (e.g., 10,000 signals/sec) as an append-only log.

**Document Structure (Conceptual):**
```json
{
  "_id": ObjectId("..."),
  "work_item_id": "uuid-from-postgres", // Links SQL to NoSQL
  "component_id": "CACHE_CLUSTER_01",
  "severity_hint": "P2",
  "timestamp": ISODate("..."),
  "payload": { ... } // Unstructured data from failing components
}
```

*SRE Note:* An index on `{ work_item_id: 1, timestamp: -1 }` ensures that querying for the sequence of errors related to an incident is extremely fast.
