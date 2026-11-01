import { fingerprint } from "./production-package.js";
import { StudioError } from "./errors.js";
export async function once(db, { tenantId, operation, key, payload }, fn) {
  if (!key || typeof key !== "string" || key.length > 160)
    throw new StudioError("IDEMPOTENCY_REQUIRED", "Idempotency-Key wajib.");
  const hash = fingerprint(payload);
  await db.query(
    "INSERT INTO idempotency_records(tenant_id,operation,key,payload_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    [tenantId, operation, key, hash],
  );
  const row = (
    await db.query(
      "SELECT * FROM idempotency_records WHERE tenant_id=$1 AND operation=$2 AND key=$3 FOR UPDATE",
      [tenantId, operation, key],
    )
  ).rows[0];
  if (row.payload_hash !== hash)
    throw new StudioError(
      "IDEMPOTENCY_CONFLICT",
      "Key sama dipakai untuk payload berbeda.",
      409,
    );
  if (row.response) return row.response;
  const value = await fn();
  await db.query(
    "UPDATE idempotency_records SET response=$4 WHERE tenant_id=$1 AND operation=$2 AND key=$3",
    [tenantId, operation, key, value],
  );
  return value;
}
export async function audit(db, actor, type, event, brandId = null) {
  await db.query(
    "INSERT INTO audit_events(tenant_id,brand_id,actor_id,event_type,event) VALUES($1,$2,$3,$4,$5)",
    [actor.tenantId, brandId, actor.id || "system", type, event],
  );
}
