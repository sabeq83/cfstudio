-- Preserve historical project references; new pool operations are key based.
ALTER TABLE gemini_pool_keys ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE gemini_pool_attempts ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE gemini_pool_keys ADD COLUMN cooldown_until timestamptz;
ALTER TABLE gemini_pool_keys ADD COLUMN exhausted_day text;
ALTER TABLE gemini_pool_keys ADD COLUMN max_concurrent integer NOT NULL DEFAULT 2 CHECK(max_concurrent>0);
UPDATE gemini_pool_keys k SET cooldown_until=p.cooldown_until,exhausted_day=p.exhausted_day FROM gemini_pool_projects p WHERE p.tenant_id=k.tenant_id AND p.id=k.project_id;
CREATE TABLE gemini_context_caches(tenant_id text NOT NULL,connection_id text NOT NULL,model text NOT NULL,prompt_hash text NOT NULL,status text NOT NULL DEFAULT 'creating',cache_name text,expires_at timestamptz NOT NULL,error_code text,PRIMARY KEY(tenant_id,connection_id,model,prompt_hash),FOREIGN KEY(tenant_id,connection_id) REFERENCES connections(tenant_id,id));
