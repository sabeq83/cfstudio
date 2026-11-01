import { transaction } from "./db-pg.js";
import { assertAccess } from "./access-control.js";
import { StudioError } from "./errors.js";
import { fingerprint } from "./production-package.js";
import { audit } from "./idempotency.js";
export const contentFingerprint = (i) =>
  fingerprint({
    revision: i.revision,
    caption: i.caption,
    artifacts: i.artifacts,
    package: i.production_package,
  });
export async function requireItem(db, actor, id, cap) {
  const item = (
    await db.query(
      "SELECT * FROM content_items WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [actor.tenantId, id],
    )
  ).rows[0];
  if (!item) throw new StudioError("NOT_FOUND", "Konten tidak ditemukan.", 404);
  assertAccess(
    actor,
    { tenantId: item.tenant_id, brandId: item.brand_id },
    cap,
  );
  return item;
}
export async function approveFinal(actor, id, revision) {
  return transaction(async (db) => {
    const item = await requireItem(db, actor, id, "content.approve");
    if (item.created_by === actor.id)
      assertAccess(
        actor,
        { tenantId: item.tenant_id, brandId: item.brand_id },
        "production.run",
      );
    if (item.revision !== revision)
      throw new StudioError("STALE_REVISION", "Versi berubah.", 409);
    if (item.status !== "ready")
      throw new StudioError("NOT_READY", "Hasil final belum siap.");
    const hash = contentFingerprint(item);
    await db.query(
      "INSERT INTO approvals(tenant_id,item_id,revision,actor_id,content_fingerprint) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [actor.tenantId, id, revision, actor.id, hash],
    );
    await audit(
      db,
      actor,
      "final.approved",
      {
        itemId: id,
        revision,
        fingerprint: hash,
        selfApproval: item.created_by === actor.id,
      },
      item.brand_id,
    );
    return { approved: true, revision, fingerprint: hash };
  });
}
export async function approveCreative(actor, id, revision) {
  return transaction(async (db) => {
    const item = await requireItem(db, actor, id, "content.approve");
    if (item.created_by === actor.id)
      assertAccess(
        actor,
        { tenantId: item.tenant_id, brandId: item.brand_id },
        "production.run",
      );
    if (item.revision !== revision)
      throw new StudioError("STALE_REVISION", "Versi berubah.", 409);
    if (item.status !== "awaiting_creative_approval")
      throw new StudioError("NOT_READY", "Materi kreatif belum siap.");
    await db.query(
      `UPDATE content_items SET status='queued',creative_decision=$3 WHERE tenant_id=$1 AND id=$2`,
      [
        actor.tenantId,
        id,
        {
          type: "human",
          actorId: actor.id,
          revision,
          fingerprint: item.production_package?.fingerprint,
        },
      ],
    );
    await db.query(
      `UPDATE automation_runs SET status='queued' WHERE tenant_id=$1 AND id=$2 AND status='awaiting_review'`,
      [actor.tenantId, item.run_id],
    );
    await audit(
      db,
      actor,
      "creative.approved",
      { itemId: id, revision },
      item.brand_id,
    );
    return { approved: true, revision };
  });
}
export async function editContent(actor, id, input) {
  return transaction(async (db) => {
    const item = await requireItem(db, actor, id, "content.edit");
    if (item.revision !== input.expectedRevision)
      throw new StudioError("STALE_REVISION", "Versi berubah.", 409);
    if (!["ready", "failed"].includes(item.status))
      throw new StudioError("NOT_EDITABLE", "Konten belum siap diedit.");
    const pending = await db.query(
      `SELECT 1 FROM publishing_intents WHERE tenant_id=$1 AND item_id=$2 AND status NOT IN('canceled','failed')`,
      [actor.tenantId, id],
    );
    if (pending.rowCount)
      throw new StudioError(
        "PUBLISHING_ACTIVE",
        "Batalkan intent provider terlebih dahulu.",
        409,
      );
    if (typeof input.caption !== "string" || !input.caption.trim())
      throw new StudioError("CAPTION_REQUIRED", "Caption wajib.");
    await db.query(
      "INSERT INTO content_revisions(tenant_id,item_id,revision,snapshot,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [actor.tenantId, id, item.revision, item, actor.id],
    );
    const updated = (
      await db.query(
        `UPDATE content_items SET caption=$3,revision=revision+1,status='ready',updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [actor.tenantId, id, input.caption.trim()],
      )
    ).rows[0];
    await audit(
      db,
      actor,
      "content.revised",
      {
        itemId: id,
        revision: updated.revision,
        invalidatesFinalApproval: true,
      },
      item.brand_id,
    );
    return updated;
  });
}
export async function retryItem(actor, id, input) {
  return transaction(async (db) => {
    const item = await requireItem(db, actor, id, "production.run");
    if (item.revision !== input.expectedRevision)
      throw new StudioError("STALE_REVISION", "Versi berubah.", 409);
    if (!["failed", "retry_wait"].includes(item.status))
      throw new StudioError("RETRY_NOT_ALLOWED", "Item tidak sedang gagal.");
    await db.query(
      `UPDATE content_items SET status='queued',error_code=NULL WHERE tenant_id=$1 AND id=$2`,
      [actor.tenantId, id],
    );
    await db.query(
      `UPDATE automation_runs SET status='queued',next_attempt_at=NULL,error_code=NULL WHERE tenant_id=$1 AND id=$2`,
      [actor.tenantId, item.run_id],
    );
    await audit(
      db,
      actor,
      "item.retry_requested",
      { itemId: id, revision: item.revision },
      item.brand_id,
    );
    return { queued: true };
  });
}

export async function regenerateItem(actor, id, input) {
  return transaction(async (db) => {
    const item = await requireItem(db, actor, id, "production.run");
    if (item.revision !== input.expectedRevision)
      throw new StudioError("STALE_REVISION", "Versi berubah.", 409);
    if (
      !["ready", "failed", "awaiting_creative_approval"].includes(item.status)
    )
      throw new StudioError("NOT_EDITABLE", "Tunggu pekerjaan aktif selesai.");
    const active = await db.query(
      `SELECT 1 FROM publishing_intents WHERE tenant_id=$1 AND item_id=$2 AND status NOT IN('canceled','failed')`,
      [actor.tenantId, id],
    );
    if (active.rowCount)
      throw new StudioError(
        "PUBLISHING_ACTIVE",
        "Batalkan jadwal sebelum membuat revisi baru.",
        409,
      );
    await db.query(
      "INSERT INTO content_revisions(tenant_id,item_id,revision,snapshot,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [actor.tenantId, id, item.revision, item, actor.id],
    );
    const updated = (
      await db.query(
        `UPDATE content_items SET revision=revision+1,status='queued',production_package=NULL,artifacts='{}',caption='',creative_decision=NULL,error_code=NULL,retry_count=0,next_attempt_at=NULL,target_config=target_config||$3::jsonb,created_by=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [
          actor.tenantId,
          id,
          {
            direction: String(
              input.direction || item.target_config.direction || "",
            ).slice(0, 4000),
          },
          actor.id,
        ],
      )
    ).rows[0];
    await db.query(
      `UPDATE automation_runs SET status='queued',next_attempt_at=NULL WHERE tenant_id=$1 AND id=$2`,
      [actor.tenantId, item.run_id],
    );
    await audit(
      db,
      actor,
      "content.regenerated",
      { itemId: id, revision: updated.revision },
      item.brand_id,
    );
    return updated;
  });
}

export async function archiveItem(actor, id, revision) {
  return transaction(async (db) => {
    const item = await requireItem(db, actor, id, "content.edit");
    if (item.revision !== revision)
      throw new StudioError("STALE_REVISION", "Versi berubah.", 409);
    if (
      !["ready", "failed", "awaiting_creative_approval"].includes(item.status)
    )
      throw new StudioError(
        "NOT_EDITABLE",
        "Pekerjaan aktif belum dapat diarsipkan.",
      );
    const active = await db.query(
      `SELECT 1 FROM publishing_intents WHERE tenant_id=$1 AND item_id=$2 AND status NOT IN('failed','canceled')`,
      [actor.tenantId, id],
    );
    if (active.rowCount)
      throw new StudioError(
        "PUBLISHING_ACTIVE",
        "Batalkan jadwal sebelum mengarsipkan konten.",
        409,
      );
    await db.query(
      `UPDATE content_items SET status='archived',updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [actor.tenantId, id],
    );
    await audit(
      db,
      actor,
      "content.archived",
      { itemId: id, revision },
      item.brand_id,
    );
    return { archived: true };
  });
}
