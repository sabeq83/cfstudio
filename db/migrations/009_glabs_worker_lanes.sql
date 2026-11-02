CREATE TABLE glabs_worker_lanes(tenant_id text NOT NULL REFERENCES tenants(id),worker text NOT NULL,next_submit_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,worker));
ALTER TABLE provider_jobs ADD COLUMN dispatch_delay_seconds integer;
