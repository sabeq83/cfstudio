import { randomUUID } from "node:crypto";
import { getPool, transaction } from "./db-pg.js";
import { assertAccess } from "./access-control.js";
import { StudioError } from "./errors.js";
import { requireCatalog } from "./catalog-service.js";
import { audit } from "./idempotency.js";
import { hashPassword } from "./security.js";
export async function actorForUser(db, userId) {
  const row = (
    await db.query(
      "SELECT u.*,t.status AS tenant_status FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.id=$1",
      [userId],
    )
  ).rows[0];
  if (!row)
    throw new StudioError("AUTH_REQUIRED", "Pengguna tidak tersedia.", 401);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    status: row.status,
    tenantStatus: row.tenant_status,
    capabilities: row.capabilities,
    brandIds: row.brand_ids,
    allBrands: row.all_brands,
    role: row.role,
  };
}
export async function listOperational(actor, kind) {
  assertAccess(actor, { tenantId: actor.tenantId }, "automation.read");
  if (kind === "history")
    return (
      await getPool().query(
        `SELECT * FROM (
 SELECT 'a-'||id::text AS id,event_type,event,created_at,brand_id FROM audit_events WHERE tenant_id=$1
 UNION ALL SELECT 'i-'||id,'pipeline.'||status,event,updated_at,brand_id FROM pipeline_incidents WHERE tenant_id=$1
 UNION ALL SELECT 'n-'||id,'telegram.'||status,jsonb_build_object('attempts',attempts,'errorCode',last_error_code),next_attempt_at,payload->>'brandId' FROM notification_outbox WHERE tenant_id=$1 AND recipient_id=$4
 UNION ALL SELECT 'c-'||id,'catalog.analysis.'||status,jsonb_build_object('objectId',object_id,'revision',revision,'errorCode',error_code),created_at,brand_id FROM catalog_jobs WHERE tenant_id=$1
 UNION ALL SELECT 'p-'||p.id,'publishing.'||p.status,jsonb_build_object('intentId',p.id,'itemId',p.item_id,'revision',p.revision,'errorCode',p.error_code,'scheduledAt',p.scheduled_at),COALESCE(p.last_checked_at,p.scheduled_at),i.brand_id FROM publishing_intents p JOIN content_items i ON i.tenant_id=p.tenant_id AND i.id=p.item_id WHERE p.tenant_id=$1
 ) events WHERE ($2::boolean OR brand_id=ANY($3::text[])) ORDER BY created_at DESC LIMIT 250`,
        [actor.tenantId, actor.allBrands, actor.brandIds, actor.id],
      )
    ).rows;
  const specs = {
    runs: [
      "automation_runs",
      "r JOIN routines x ON x.tenant_id=r.tenant_id AND x.id=r.routine_id",
      "x.brand_id",
      "r.created_at DESC",
    ],
    items: ["content_items", "r", "r.brand_id", "r.updated_at DESC"],
    publishing: [
      "publishing_intents",
      "r JOIN content_items x ON x.tenant_id=r.tenant_id AND x.id=r.item_id",
      "x.brand_id",
      "r.scheduled_at",
    ],
    history: ["audit_events", "r", "r.brand_id", "r.created_at DESC"],
  };
  if (!specs[kind])
    throw new StudioError("NOT_FOUND", "Data tidak ditemukan.", 404);
  const [table, join, brand, order] = specs[kind];
  return (
    await getPool().query(
      `SELECT r.*${kind === "items" ? `,EXISTS(SELECT 1 FROM approvals a WHERE a.tenant_id=r.tenant_id AND a.item_id=r.id AND a.revision=r.revision) AS approved,(SELECT output FROM stage_executions s WHERE s.tenant_id=r.tenant_id AND s.item_id=r.id AND s.revision=r.revision AND s.stage='start_frames' AND s.status='completed') AS creative_frames` : ""} FROM ${table} ${join} WHERE r.tenant_id=$1 AND ($2::boolean OR ${brand}=ANY($3::text[])) ORDER BY ${order} LIMIT 250`,
      [actor.tenantId, actor.allBrands, actor.brandIds],
    )
  ).rows;
}
export async function listUsers(actor) {
  assertAccess(actor, { tenantId: actor.tenantId }, "tenant.users.manage");
  return (
    await getPool().query(
      "SELECT id,username,role,status,capabilities,brand_ids,all_brands FROM users WHERE tenant_id=$1 ORDER BY username",
      [actor.tenantId],
    )
  ).rows;
}
const allowedCaps = [
  "catalog.read",
  "catalog.manage",
  "automation.read",
  "automation.manage",
  "production.run",
  "content.edit",
  "content.approve",
  "publishing.schedule",
  "publishing.cancel",
  "integration.manage",
  "tenant.users.manage",
];
export async function createUser(actor, input) {
  assertAccess(actor, { tenantId: actor.tenantId }, "tenant.users.manage");
  if (
    !input.username?.trim() ||
    !["admin", "operator", "reviewer", "publisher", "viewer", "user"].includes(
      input.role,
    ) ||
    !Array.isArray(input.capabilities) ||
    input.capabilities.some((c) => !allowedCaps.includes(c))
  )
    throw new StudioError(
      "USER_INVALID",
      "Data atau capability pengguna tidak valid.",
    );
  if (input.allBrands && !actor.allBrands)
    throw new StudioError(
      "BRAND_ACCESS_DENIED",
      "Pengelola brand tidak boleh memberikan akses seluruh tenant.",
      403,
    );
  if (input.capabilities.some((c) => !actor.capabilities.includes(c)))
    throw new StudioError(
      "CAPABILITY_REQUIRED",
      "Izin baru tidak boleh melebihi izin pengelola.",
      403,
    );
  if (
    typeof input.password !== "string" ||
    input.password.length < 12 ||
    input.password.length > 512
  )
    throw new StudioError("PASSWORD_INVALID", "Password minimal 12 karakter.");
  return transaction(async (db) => {
    for (const brandId of input.brandIds || []) {
      const b = await requireCatalog(db, actor, brandId);
      if (b.domain !== "brand")
        throw new StudioError("BRAND_INVALID", "Assignment bukan brand.");
    }
    const user = (
      await db.query(
        "INSERT INTO users(id,tenant_id,username,password_hash,role,capabilities,brand_ids,all_brands) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,username,role,status,capabilities,brand_ids,all_brands",
        [
          randomUUID(),
          actor.tenantId,
          input.username.trim(),
          hashPassword(input.password),
          input.role,
          JSON.stringify(input.capabilities),
          JSON.stringify(input.brandIds || []),
          Boolean(input.allBrands),
        ],
      )
    ).rows[0];
    await audit(db, actor, "user.created", {
      userId: user.id,
      role: user.role,
    });
    return user;
  });
}
