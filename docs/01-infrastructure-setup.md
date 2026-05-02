# Step 1: Core Infrastructure Setup

## Overview
As part of our production-grade Incident Management System (IMC), our first step is to establish a resilient, isolated data layer. We are using `docker-compose` to orchestrate this environment locally while mimicking production constraints.

## Architecture Decisions

1. **PostgreSQL (The Anchor)**
   - **Role:** Primary relational datastore.
   - **Use Case:** Stores critical, highly-structured data with ACID guarantees (e.g., incident state changes, user roles, core metadata).
   - **SRE View:** We've configured connection health checks (`pg_isready`) and memory limits (512M) to prevent Out-Of-Memory (OOM) situations on the host if queries run wild.

2. **MongoDB (The Dumping Ground)**
   - **Role:** High-throughput document store.
   - **Use Case:** Ingesting and storing raw logs, unstructured incident context, and high-volume payload dumps that don't fit neatly into relational tables.
   - **SRE View:** Mongo can be memory-hungry. We've capped it at 1GB of memory and added a 40-second `start_period` for its health check to account for journal initialization. 

3. **Redis (The Buffer & Cache)**
   - **Role:** In-memory datastore and message broker.
   - **Use Case:** Caching frequent queries, rate-limiting API requests, and managing event queues (via Redis Streams) for asynchronous incident processing.
   - **SRE View:** Configured with `appendonly yes` for basic persistence so we don't lose queue data across container restarts. Memory constrained to 256M.

## Reliability Engineering (SRE) Aspects Implemented

- **Resource Limits (`deploy.resources.limits`)**: Essential for multi-tenant or shared-node environments. Prevents the "noisy neighbor" problem where one runaway database crashes the others.
- **Health Checks (`healthcheck`)**: Docker won't just check if the process is running; it actively queries the databases. This is critical for downstream services (like our future API) so they can use `depends_on: service_healthy`.
- **Restarts (`restart: unless-stopped`)**: Ensures our infrastructure recovers from transient crashes automatically.
- **Persistent Volumes**: Using named volumes (`postgres_data`, `mongo_data`, `redis_data`) so container recreation doesn't mean data loss.

## How to Run

1. Navigate to the `IMC` directory.
2. Run the environment:
   ```bash
   docker-compose up -d
   ```
3. Check the health status of all containers:
   ```bash
   docker-compose ps
   ```
