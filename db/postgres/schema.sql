CREATE TYPE incident_status AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED');
CREATE TYPE incident_severity AS ENUM ('P0', 'P1', 'P2', 'P3');

CREATE TABLE work_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    component_id VARCHAR(255) NOT NULL, -- e.g., 'CACHE_CLUSTER_01'
    severity incident_severity NOT NULL,
    status incident_status DEFAULT 'OPEN',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), -- Used for MTTR Start Time
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookups when the frontend queries active incidents
CREATE INDEX idx_work_items_status ON work_items(status);

CREATE TABLE rca_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_item_id UUID UNIQUE NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    root_cause_category VARCHAR(100) NOT NULL,
    fix_applied TEXT NOT NULL,
    prevention_steps TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() -- Used for MTTR End Time
);
