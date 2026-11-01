import {
  validateProviderMediaContract,
  PUBLISHING_PLATFORMS,
} from "./legacy/publishing-contract.js";
import { randomUUID } from "node:crypto";
import { getPool, transaction } from "./db-pg.js";
import { assertAccess } from "./access-control.js";
import { requireItem, contentFingerprint } from "./review-service.js";
import { decryptSecret } from "./connections.js";
import { loadArtifact, signedMediaUrl } from "./artifact-store.js";
import { gateway, requireDispatch } from "./provider-gateway.js";
import { once, audit } from "./idempotency.js";
import { StudioError } from "./errors.js";
import { queueNotification } from "./notification-service.js";
export function providerState(response) {
  const v = response?.data || response?.schedule || response || {};
  const id = v.id || v._id || v.scheduleId;
  const state = String(v.status || v.state || "unknown").toLowerCase();
  const post = v.postId || v.post_id || v.externalId;
  const postId =
    typeof post === "string"
      ? post
      : post?.type === "schedule"
        ? null
        : post?.id;
  const proof = Boolean(postId || v.permalink || v.publishedUrl);
  return {
    id: id ? String(id) : null,
    status:
      ["published", "completed", "success"].includes(state) && proof
        ? "published"
        : ["failed", "error", "rejected"].includes(state)
          ? "failed"
          : ["canceled", "cancelled", "deleted"].includes(state)
            ? "canceled"
            : "accepted",
  };
}
async function accountFor(db, actor, id, brandId) {
  const a = (
    await db.query(
      `SELECT a.*,c.config,c.secret_ciphertext,c.kind,c.status AS connection_status FROM integration_accounts a JOIN connections c ON c.tenant_id=a.tenant_id AND c.id=a.connection_id WHERE a.tenant_id=$1 AND a.id=$2 AND a.brand_id=$3`,
      [actor.tenantId, id, brandId],
    )
  ).rows[0];
  if (!a || !a.connected || a.connection_status !== "configured")
    throw new StudioError(
      "ACCOUNT_UNAVAILABLE",
      "Akun Repliz tidak terhubung.",
    );
  assertAccess(
    actor,
    { tenantId: actor.tenantId, brandId },
    "publishing.schedule",
  );
  return a;
}
export async function listAccounts(actor) {
  assertAccess(actor, { tenantId: actor.tenantId }, "publishing.schedule");
  return (
    await getPool().query(
      "SELECT id,brand_id,label,platform,connected,capabilities FROM integration_accounts WHERE tenant_id=$1 AND ($2::boolean OR brand_id=ANY($3::text[]))",
      [actor.tenantId, actor.allBrands, actor.brandIds],
    )
  ).rows;
}
export async function syncAccounts(actor, input) {
  assertAccess(
    actor,
    { tenantId: actor.tenantId, brandId: input.brandId },
    "integration.manage",
  );
  const db = getPool();
  const brand = (
    await db.query(
      `SELECT id FROM catalog_items WHERE tenant_id=$1 AND id=$2 AND domain='brand' AND archived=false`,
      [actor.tenantId, input.brandId],
    )
  ).rows[0];
  if (!brand) throw new StudioError("BRAND_INVALID", "Brand tidak tersedia.");
  const c = (
    await db.query(
      `SELECT * FROM connections WHERE tenant_id=$1 AND id=$2 AND kind='repliz' AND status='configured' AND (brand_id=$3 OR brand_id IS NULL)`,
      [actor.tenantId, input.connectionId, input.brandId],
    )
  ).rows[0];
  if (!c)
    throw new StudioError(
      "CONNECTION_REQUIRED",
      "Koneksi Repliz belum tersedia.",
    );
  const result = await gateway.json(
    { ...c, secret: decryptSecret(c.secret_ciphertext) },
    "GET",
    "public/account?page=1&limit=100",
    null,
    { readOnly: true },
  );
  const values = Array.isArray(result) ? result : result.docs || result.data;
  if (!Array.isArray(values))
    throw new StudioError(
      "ACCOUNT_RESPONSE_INVALID",
      "Respons daftar akun tidak valid.",
    );
  if (!input.accountIds)
    return {
      available: values.map((v) => ({
        id: String(v.id || v._id),
        label: v.username || v.name || "Akun",
        platform: v.platform || v.type,
        isConnected: v.isConnected !== false,
      })),
    };
  return transaction(async (tx) => {
    const selected = values.filter((v) =>
      input.accountIds.includes(String(v.id || v._id)),
    );
    if (selected.length !== input.accountIds.length)
      throw new StudioError("ACCOUNT_INVALID", "Akun pilihan tidak ditemukan.");
    for (const a of selected) {
      const platform = String(a.platform || a.type || "").toLowerCase();
      if (!PUBLISHING_PLATFORMS.includes(platform))
        throw new StudioError(
          "PLATFORM_UNSUPPORTED",
          "Platform akun ini belum didukung oleh kontrak V2.",
        );
      const pid = String(a.id || a._id),
        id = c.id + ":" + input.brandId + ":" + pid;
      await tx.query(
        `INSERT INTO integration_accounts(id,tenant_id,brand_id,connection_id,provider_account_id,label,platform,connected,capabilities) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,id) DO UPDATE SET connected=EXCLUDED.connected,label=EXCLUDED.label,capabilities=EXCLUDED.capabilities`,
        [
          id,
          actor.tenantId,
          input.brandId,
          c.id,
          pid,
          a.username || a.name || pid,
          platform,
          a.isConnected !== false,
          { verifiedAt: new Date().toISOString(), video: true, image: true },
        ],
      );
    }
    await audit(
      tx,
      actor,
      "accounts.mapped",
      { brandId: input.brandId, count: selected.length },
      input.brandId,
    );
    return { mapped: selected.length };
  });
}
export async function preflight(db, actor, itemId, input) {
  const item = await requireItem(db, actor, itemId, "publishing.schedule");
  if (item.status !== "ready" || item.revision !== input.revision)
    throw new StudioError(
      "STALE_REVISION",
      "Hasil siap dan revisi yang sama diperlukan.",
      409,
    );
  const approval = (
    await db.query(
      "SELECT * FROM approvals WHERE tenant_id=$1 AND item_id=$2 AND revision=$3",
      [actor.tenantId, itemId, item.revision],
    )
  ).rows[0];
  if (!approval || approval.content_fingerprint !== contentFingerprint(item))
    throw new StudioError(
      "FINAL_APPROVAL_REQUIRED",
      "Review dan persetujuan final versi ini diperlukan.",
      409,
    );
  const account = await accountFor(db, actor, input.accountId, item.brand_id);
  const date = new Date(input.scheduledAt);
  if (!Number.isFinite(date.getTime()) || date < Date.now() + 60000)
    throw new StudioError(
      "SCHEDULE_INVALID",
      "Pilih waktu publikasi setidaknya satu menit dari sekarang.",
    );
  const assetId = item.artifacts?.final?.id;
  if (!assetId)
    throw new StudioError(
      "FINAL_ASSET_REQUIRED",
      "Media final belum tersedia.",
    );
  const { asset } = await loadArtifact(actor.tenantId, assetId);
  const mediaType = asset.mime_type.startsWith("video/")
    ? "video"
    : asset.mime_type.startsWith("image/")
      ? "image"
      : null;
  if (
    !mediaType ||
    asset.object_id !== item.id ||
    asset.brand_id !== item.brand_id
  )
    throw new StudioError("FINAL_ASSET_INVALID", "Media final tidak cocok.");
  try {
    validateProviderMediaContract({
      provider: "repliz",
      platform: account.platform,
      mediaType,
      publishMode: "live",
    });
  } catch {
    throw new StudioError(
      "MEDIA_UNSUPPORTED",
      "Platform atau media tidak didukung.",
    );
  }
  if (account.capabilities[mediaType] !== true)
    throw new StudioError(
      "MEDIA_UNSUPPORTED",
      "Akun tidak mendukung jenis media ini.",
    );
  return { item, account, asset, date, mediaType };
}
export async function createPublishingIntent(actor, itemId, input, key) {
  return transaction(async (db) =>
    once(
      db,
      {
        tenantId: actor.tenantId,
        operation: "schedule:" + itemId,
        key,
        payload: input,
      },
      async () => {
        const { item, account, asset, date, mediaType } = await preflight(
          db,
          actor,
          itemId,
          input,
        );
        const snapshot = {
          caption: item.caption,
          title: item.production_package?.socialPackage?.title || "",
          brandId: item.brand_id,
          fingerprint: contentFingerprint(item),
          assetId: asset.id,
          sha256: asset.sha256,
          mediaType,
          providerAccountId: account.provider_account_id,
          connectionId: account.connection_id,
          platform: account.platform,
        };
        const row = (
          await db.query(
            `INSERT INTO publishing_intents(id,tenant_id,item_id,revision,account_id,scheduled_at,status,snapshot,requested_by) VALUES($1,$2,$3,$4,$5,$6,'queued',$7,$8) ON CONFLICT(tenant_id,item_id,revision,account_id,scheduled_at) DO UPDATE SET snapshot=publishing_intents.snapshot RETURNING *`,
            [
              randomUUID(),
              actor.tenantId,
              itemId,
              item.revision,
              account.id,
              date,
              snapshot,
              actor.id,
            ],
          )
        ).rows[0];
        await audit(
          db,
          actor,
          "publishing.queued",
          {
            intentId: row.id,
            itemId,
            revision: item.revision,
            scheduledAt: date,
          },
          item.brand_id,
        );
        return row;
      },
    ),
  );
}
async function requireIntent(db, actor, id) {
  const row = (
    await db.query(
      "SELECT p.*,i.brand_id FROM publishing_intents p JOIN content_items i ON i.tenant_id=p.tenant_id AND i.id=p.item_id WHERE p.tenant_id=$1 AND p.id=$2 FOR UPDATE OF p",
      [actor.tenantId, id],
    )
  ).rows[0];
  if (!row) throw new StudioError("NOT_FOUND", "Jadwal tidak ditemukan.", 404);
  assertAccess(
    actor,
    { tenantId: actor.tenantId, brandId: row.brand_id },
    "publishing.schedule",
  );
  return row;
}
export async function cancelIntent(actor, id) {
  return transaction(async (db) => {
    const intent = await requireIntent(db, actor, id);
    assertAccess(
      actor,
      { tenantId: actor.tenantId, brandId: intent.brand_id },
      "publishing.cancel",
    );
    if (
      ["queued", "draft", "failed"].includes(intent.status) &&
      !intent.provider_id
    ) {
      await db.query(
        `UPDATE publishing_intents SET status='canceled' WHERE id=$1`,
        [id],
      );
      return { canceled: true };
    }
    if (intent.provider_id && intent.status === "accepted") {
      await db.query(
        `UPDATE publishing_intents SET status='cancel_requested',cancel_requested_by=$3 WHERE tenant_id=$1 AND id=$2`,
        [actor.tenantId, id, actor.id],
      );
      await audit(
        db,
        actor,
        "publishing.cancel_requested",
        { intentId: id },
        intent.brand_id,
      );
      return { cancelRequested: true };
    }
    throw new StudioError(
      "PROVIDER_CANCEL_REQUIRED",
      "Rekonsiliasi status provider diperlukan sebelum pembatalan.",
      409,
    );
  });
}
export async function reconcileIntent(actor, id, input = {}) {
  const intent = await transaction((db) => requireIntent(db, actor, id));
  const providerId = intent.provider_id || input.providerId;
  if (!providerId)
    throw new StudioError(
      "PROVIDER_ID_REQUIRED",
      "Masukkan ID jadwal dari dashboard Repliz untuk rekonsiliasi. Jangan membuat ulang jadwal.",
      409,
    );
  const account = await accountFor(
    getPool(),
    actor,
    intent.account_id,
    intent.brand_id,
  );
  const connection = {
    ...account,
    secret: decryptSecret(account.secret_ciphertext),
  };
  const result = await gateway.json(
    connection,
    "GET",
    "public/schedule/" + encodeURIComponent(providerId),
    null,
    { readOnly: true },
  );
  const v = result.data || result.schedule || result;
  const remoteAccount = String(
    v.accountId || v.account?.id || v.account?._id || "",
  );
  if (remoteAccount !== account.provider_account_id)
    throw new StudioError(
      "RECONCILIATION_MISMATCH",
      "Akun jadwal provider tidak cocok.",
      409,
    );
  if (!intent.provider_id) {
    const media = v.medias?.[0]?.url || "";
    if (
      v.description !== intent.snapshot.caption ||
      Math.abs(
        new Date(v.scheduleAt).getTime() -
          new Date(intent.scheduled_at).getTime(),
      ) > 1000 ||
      !media.includes(encodeURIComponent(intent.snapshot.assetId))
    )
      throw new StudioError(
        "RECONCILIATION_MISMATCH",
        "Media, caption, atau waktu provider tidak cocok.",
        409,
      );
  }
  const state = providerState(result);
  await getPool().query(
    "UPDATE publishing_intents SET provider_id=$3,status=$4,last_checked_at=now(),error_code=NULL WHERE tenant_id=$1 AND id=$2 AND status<>$5",
    [actor.tenantId, id, String(providerId), state.status, "published"],
  );
  return state;
}
export async function processPublishing(workerId) {
  requireDispatch("publishing");
  const db = getPool();
  await db.query(
    `UPDATE publishing_intents SET status='unknown',error_code='PROVIDER_OUTCOME_UNKNOWN' WHERE status IN('submitting','canceling') AND lease_expires_at<now()`,
  );
  const intent = await transaction(async (tx) => {
    const row = (
      await tx.query(
        `SELECT p.* FROM publishing_intents p JOIN tenants t ON t.id=p.tenant_id WHERE t.status='active' AND p.status IN('queued','cancel_requested') ORDER BY p.scheduled_at FOR UPDATE OF p SKIP LOCKED LIMIT 1`,
      )
    ).rows[0];
    if (!row) return null;
    return (
      await tx.query(
        `UPDATE publishing_intents SET status=CASE WHEN status='cancel_requested' THEN 'canceling' ELSE 'submitting' END,lease_owner=$2,lease_expires_at=now()+interval '5 minutes',fencing_token=fencing_token+1 WHERE id=$1 RETURNING *`,
        [row.id, workerId],
      )
    ).rows[0];
  });
  if (!intent) return false;
  let status = "failed",
    providerId = null,
    error = null;
  try {
    const { actorForUser } = await import("./operations-service.js");
    const actor = await actorForUser(
      db,
      intent.status === "canceling"
        ? intent.cancel_requested_by
        : intent.requested_by,
    );
    if (intent.status === "canceling") {
      assertAccess(
        actor,
        { tenantId: intent.tenant_id, brandId: intent.snapshot.brandId },
        "publishing.cancel",
      );
      const account = await accountFor(
        db,
        actor,
        intent.account_id,
        intent.snapshot.brandId,
      );
      await gateway.json(
        { ...account, secret: decryptSecret(account.secret_ciphertext) },
        "DELETE",
        "public/schedule/" + encodeURIComponent(intent.provider_id),
        null,
        { dispatch: "publishing" },
      );
      status = "canceled";
      providerId = intent.provider_id;
    } else {
      const { item, account, asset, date, mediaType } = await transaction(
        (tx) =>
          preflight(tx, actor, intent.item_id, {
            revision: intent.revision,
            accountId: intent.account_id,
            scheduledAt: intent.scheduled_at,
          }),
      );
      if (
        contentFingerprint(item) !== intent.snapshot.fingerprint ||
        asset.sha256 !== intent.snapshot.sha256
      )
        throw new StudioError("SNAPSHOT_CHANGED", "Snapshot berubah.", 409);
      const health = await gateway.json(
        { ...account, secret: decryptSecret(account.secret_ciphertext) },
        "GET",
        "public/account/" + encodeURIComponent(account.provider_account_id),
        null,
        { readOnly: true },
      );
      if ((health.data || health).isConnected !== true)
        throw new StudioError(
          "ACCOUNT_UNAVAILABLE",
          "Akun provider belum terbukti terhubung.",
        );
      const ttl = Math.ceil((date.getTime() - Date.now()) / 1000) + 3600;
      if (ttl > 86400)
        throw new StudioError(
          "MEDIA_EXPIRY_TOO_SHORT",
          "Media lokal bertanda tangan mendukung jadwal maksimal 23 jam. Siapkan public storage untuk jadwal lebih jauh.",
        );
      const url = signedMediaUrl(asset, ttl);
      const publicUrl = new URL(url);
      if (
        publicUrl.protocol !== "https:" ||
        ["localhost", "127.0.0.1"].includes(publicUrl.hostname)
      )
        throw new StudioError(
          "PUBLIC_MEDIA_REQUIRED",
          "Media harus bisa diakses provider melalui HTTPS publik.",
        );
      const response = await gateway.json(
        { ...account, secret: decryptSecret(account.secret_ciphertext) },
        "POST",
        "public/schedule",
        {
          accountId: account.provider_account_id,
          scheduleAt: date.toISOString(),
          type: mediaType,
          title: intent.snapshot.title,
          description: intent.snapshot.caption,
          medias: [{ type: mediaType, url, alt: "" }],
          additionalInfo: {
            isAiGenerated: true,
            isDraft: false,
            isAutoAddMusic: false,
          },
          replies: [],
        },
        { dispatch: "publishing" },
      );
      const state = providerState(response);
      if (!state.id)
        throw new StudioError(
          "PROVIDER_OUTCOME_UNKNOWN",
          "Provider belum memberikan ID jadwal.",
        );
      providerId = state.id;
      status = state.status;
    }
  } catch (e) {
    error = e.code || "PUBLISHING_FAILED";
    status = [
      "PROVIDER_OUTCOME_UNKNOWN",
      "PROVIDER_INVALID_RESPONSE",
      "PROVIDER_UNAVAILABLE",
    ].includes(error)
      ? "unknown"
      : "failed";
  }
  await transaction(async (tx) => {
    const result = await tx.query(
      `UPDATE publishing_intents SET status=$4,provider_id=$5,error_code=$6,last_checked_at=now(),lease_owner=NULL,lease_expires_at=NULL WHERE id=$1 AND lease_owner=$2 AND fencing_token=$3`,
      [
        intent.id,
        workerId,
        intent.fencing_token,
        status,
        providerId || intent.provider_id,
        error,
      ],
    );
    if (result.rowCount && ["failed", "unknown"].includes(status))
      await queueNotification(tx, {
        tenantId: intent.tenant_id,
        brandId: intent.snapshot.brandId,
        eventKey: "publishing-error:" + intent.id,
        eventType: "error",
        message:
          "CF Studio • Repliz memerlukan pemeriksaan. Status: " +
          status +
          ". Buka Schedule sebelum mencoba kembali.",
      });
  });
  return true;
}

export async function reconcilePublishing() {
  requireDispatch("publishing");
  const db = getPool();
  const row = (
    await db.query(
      `SELECT p.* FROM publishing_intents p JOIN tenants t ON t.id=p.tenant_id WHERE p.status='accepted' AND p.provider_id IS NOT NULL AND t.status='active' AND (p.last_checked_at IS NULL OR p.last_checked_at<now()-interval '30 seconds') ORDER BY p.last_checked_at NULLS FIRST LIMIT 1`,
    )
  ).rows[0];
  if (!row) return false;
  await db.query(
    "UPDATE publishing_intents SET last_checked_at=now() WHERE id=$1",
    [row.id],
  );
  try {
    const { actorForUser } = await import("./operations-service.js");
    const actor = await actorForUser(db, row.requested_by);
    const state = await reconcileIntent(actor, row.id);
    if (["published", "failed"].includes(state.status))
      await queueNotification(db, {
        tenantId: row.tenant_id,
        brandId: row.snapshot.brandId,
        eventKey: "provider-status:" + row.id + ":" + state.status,
        eventType: state.status === "failed" ? "error" : "ready",
        message:
          "CF Studio • Status publikasi Repliz: " +
          state.status +
          ". Buka Schedule.",
      });
  } catch (e) {
    await db.query("UPDATE publishing_intents SET error_code=$2 WHERE id=$1", [
      row.id,
      e.code || "RECONCILIATION_FAILED",
    ]);
  }
  return true;
}
