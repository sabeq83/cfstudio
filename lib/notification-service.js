import { randomBytes, createHash, randomUUID } from "node:crypto";
import { getPool, transaction } from "./db-pg.js";
import { assertAccess } from "./access-control.js";
import { decryptSecret } from "./connections.js";
import { requireDispatch } from "./provider-gateway.js";
import { StudioError } from "./errors.js";
export function inQuietHours(pref, now = new Date()) {
  if (
    !pref.quiet_start ||
    !pref.quiet_end ||
    pref.quiet_start === pref.quiet_end
  )
    return false;
  const current = new Intl.DateTimeFormat("en-GB", {
    timeZone: pref.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return pref.quiet_start < pref.quiet_end
    ? current >= pref.quiet_start && current < pref.quiet_end
    : current >= pref.quiet_start || current < pref.quiet_end;
}
async function bot(connection, method, body) {
  requireDispatch("telegram");
  const secret =
    connection.secret || decryptSecret(connection.secret_ciphertext);
  if (!secret.botToken)
    throw new StudioError("TELEGRAM_TOKEN_REQUIRED", "Token bot belum diatur.");
  let r;
  try {
    r = await fetch(
      `https://api.telegram.org/bot${secret.botToken}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      },
    );
  } catch {
    throw new StudioError(
      "TELEGRAM_OUTCOME_UNKNOWN",
      "Hasil Telegram belum dapat dipastikan.",
    );
  }
  const value = await r.json();
  if (r.status === 429)
    throw new StudioError(
      "TELEGRAM_RATE_LIMIT",
      "Telegram membatasi frekuensi. Coba ulang terjadwal.",
    );
  if (!r.ok || !value.ok)
    throw new StudioError("TELEGRAM_REJECTED", "Telegram menolak permintaan.");
  return value.result;
}
export async function startTelegramVerification(actor, input) {
  assertAccess(actor, { tenantId: actor.tenantId }, "automation.read");
  const c = (
    await getPool().query(
      `SELECT * FROM connections WHERE tenant_id=$1 AND id=$2 AND kind='telegram' AND status='configured' AND brand_id IS NULL`,
      [actor.tenantId, input.connectionId],
    )
  ).rows[0];
  if (!c)
    throw new StudioError("CONNECTION_REQUIRED", "Pilih koneksi bot tenant.");
  const code = randomBytes(18).toString("base64url");
  await transaction(async (db) => {
    await db.query(
      `INSERT INTO telegram_verification_challenges VALUES($1,$2,$3,now()+interval '15 minutes') ON CONFLICT(tenant_id,user_id) DO UPDATE SET challenge_hash=EXCLUDED.challenge_hash,expires_at=EXCLUDED.expires_at`,
      [
        actor.tenantId,
        actor.id,
        createHash("sha256").update(code).digest("hex"),
      ],
    );
    await db.query(
      `INSERT INTO notification_preferences(tenant_id,user_id,connection_id) VALUES($1,$2,$3) ON CONFLICT(tenant_id,user_id) DO UPDATE SET connection_id=$3,verified=false,chat_id=NULL`,
      [actor.tenantId, actor.id, c.id],
    );
  });
  return {
    instruction:
      "Kirim pesan ini ke bot Telegram CF Studio, lalu klik Verifikasi.",
    message: "/start " + code,
    expiresInMinutes: 15,
  };
}
export async function finishTelegramVerification(actor, input) {
  const db = getPool();
  const r = (
    await db.query(
      `SELECT c.*,v.challenge_hash FROM notification_preferences p JOIN connections c ON c.tenant_id=p.tenant_id AND c.id=p.connection_id AND c.status='configured' JOIN telegram_verification_challenges v ON v.tenant_id=p.tenant_id AND v.user_id=p.user_id WHERE p.tenant_id=$1 AND p.user_id=$2 AND v.expires_at>now()`,
      [actor.tenantId, actor.id],
    )
  ).rows[0];
  if (!r) throw new StudioError("CHALLENGE_EXPIRED", "Mulai verifikasi baru.");
  const updates = await bot(r, "getUpdates", { limit: 100, timeout: 0 });
  const match = updates.find((u) => {
    const m = u.message;
    return (
      m?.chat?.type === "private" &&
      m.text?.startsWith("/start ") &&
      createHash("sha256").update(m.text.slice(7).trim()).digest("hex") ===
        r.challenge_hash
    );
  });
  if (!match)
    throw new StudioError(
      "VERIFICATION_PENDING",
      "Pesan verifikasi belum diterima bot.",
    );
  for (const value of [input.quietStart, input.quietEnd])
    if (value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
      throw new StudioError("TIME_INVALID", "Jam tidak valid.");
  await transaction(async (tx) => {
    await tx.query(
      `UPDATE notification_preferences SET chat_id=$3,verified=true,enabled=true,quiet_start=$4,quiet_end=$5 WHERE tenant_id=$1 AND user_id=$2`,
      [
        actor.tenantId,
        actor.id,
        String(match.message.chat.id),
        input.quietStart || null,
        input.quietEnd || null,
      ],
    );
    await tx.query(
      "DELETE FROM telegram_verification_challenges WHERE tenant_id=$1 AND user_id=$2",
      [actor.tenantId, actor.id],
    );
  });
  return { verified: true };
}
export async function queueNotification(
  db,
  { tenantId, brandId, eventKey, eventType, message },
) {
  const users = (
    await db.query(
      `SELECT p.user_id FROM notification_preferences p JOIN users u ON u.tenant_id=p.tenant_id AND u.id=p.user_id JOIN tenants t ON t.id=u.tenant_id WHERE p.tenant_id=$1 AND p.verified=true AND p.enabled=true AND p.events ? $2 AND u.status='active' AND t.status='active' AND u.capabilities ? 'automation.read' AND (u.all_brands=true OR u.brand_ids ? $3)`,
      [tenantId, eventType, brandId],
    )
  ).rows;
  for (const user of users)
    await db.query(
      `INSERT INTO notification_outbox(id,tenant_id,event_key,payload,recipient_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [
        randomUUID(),
        tenantId,
        eventKey + ":" + user.user_id,
        { brandId, eventType, message },
        user.user_id,
      ],
    );
}
export async function deliverNotification(workerId) {
  requireDispatch("telegram");
  await getPool().query(
    `UPDATE notification_outbox SET status='unknown',last_error_code='TELEGRAM_OUTCOME_UNKNOWN' WHERE status='sending' AND lease_expires_at<now()`,
  );
  const claim = await transaction(async (db) => {
    const r = (
      await db.query(
        `SELECT * FROM notification_outbox WHERE status='queued' AND next_attempt_at<=now() ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1`,
      )
    ).rows[0];
    if (!r) return null;
    return (
      await db.query(
        `UPDATE notification_outbox SET status='sending',lease_owner=$2,lease_expires_at=now()+interval '1 minute',fencing_token=fencing_token+1 WHERE id=$1 RETURNING *`,
        [r.id, workerId],
      )
    ).rows[0];
  });
  if (!claim) return false;
  const db = getPool();
  const pref = (
    await db.query(
      `SELECT p.*,c.secret_ciphertext,c.config FROM notification_preferences p JOIN users u ON u.tenant_id=p.tenant_id AND u.id=p.user_id JOIN tenants t ON t.id=u.tenant_id JOIN connections c ON c.tenant_id=p.tenant_id AND c.id=p.connection_id AND c.status='configured' WHERE p.tenant_id=$1 AND p.user_id=$2 AND p.verified=true AND p.enabled=true AND u.status='active' AND t.status='active' AND u.capabilities ? 'automation.read' AND (u.all_brands=true OR u.brand_ids ? $3)`,
      [claim.tenant_id, claim.recipient_id, claim.payload.brandId],
    )
  ).rows[0];
  let status = "sent",
    error = null,
    next = null;
  if (!pref) status = "canceled";
  else if (inQuietHours(pref)) {
    status = "queued";
    next = new Date(Date.now() + 60000);
  } else
    try {
      await bot(pref, "sendMessage", {
        chat_id: pref.chat_id,
        text: claim.payload.message,
        disable_web_page_preview: true,
      });
    } catch (e) {
      error = e.code || "TELEGRAM_FAILED";
      status =
        e.code === "TELEGRAM_OUTCOME_UNKNOWN"
          ? "unknown"
          : e.code === "TELEGRAM_RATE_LIMIT" && claim.attempts < 3
            ? "queued"
            : "failed";
      if (status === "queued") next = new Date(Date.now() + 60000);
    }
  await db.query(
    `UPDATE notification_outbox SET status=$3,last_error_code=$4,attempts=attempts+1,next_attempt_at=COALESCE($5,next_attempt_at),lease_owner=NULL,lease_expires_at=NULL WHERE id=$1 AND fencing_token=$2 AND lease_owner=$6`,
    [claim.id, claim.fencing_token, status, error, next, workerId],
  );
  return true;
}

export async function listTelegramBots(actor) {
  assertAccess(actor, { tenantId: actor.tenantId }, "automation.read");
  return (
    await getPool().query(
      `SELECT id,label FROM connections WHERE tenant_id=$1 AND kind='telegram' AND status='configured' AND brand_id IS NULL`,
      [actor.tenantId],
    )
  ).rows;
}
