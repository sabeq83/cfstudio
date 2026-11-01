ALTER TABLE content_items ADD COLUMN retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE content_items ADD COLUMN next_attempt_at timestamptz;
