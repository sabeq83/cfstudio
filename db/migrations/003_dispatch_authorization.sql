ALTER TABLE publishing_intents ADD COLUMN requested_by text;
CREATE INDEX outbox_due ON notification_outbox(status,next_attempt_at);
CREATE INDEX stage_item_revision ON stage_executions(tenant_id,item_id,revision);
