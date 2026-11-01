import { randomUUID, createHash } from "node:crypto";
import { getPool, transaction } from "./db-pg.js";
import { assertAccess } from "./access-control.js";
import { encryptSecret, decryptSecret } from "./connections.js";
import { StudioError } from "./errors.js";
import { audit } from "./idempotency.js";
export function requireIntegrationAdmin(actor) {
  assertAccess(actor, { tenantId: actor.tenantId }, "integration.manage");
  if (!actor.allBrands)
    throw new StudioError(
      "GLOBAL_CONNECTION_DENIED",
      "Pengaturan tenant memerlukan pengelola seluruh brand.",
      403,
    );
}
export function budgetDay(timezone = "Asia/Jakarta", date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export async function poolSettings(tenantId) {
  return (
    (
      await getPool().query(
        `SELECT config FROM integration_settings WHERE tenant_id=$1 AND kind='gemini'`,
        [tenantId],
      )
    ).rows[0]?.config || {
      model: "",
      ttsModel: "gemini-2.5-flash-preview-tts",
      budgetTimezone: "Asia/Jakarta",
    }
  );
}
export async function savePoolSettings(actor, input) {
  requireIntegrationAdmin(actor);
  if (!input.model?.trim())
    throw new StudioError("MODEL_REQUIRED", "Pilih model Gemini.");
  new Intl.DateTimeFormat("en", {
    timeZone: input.budgetTimezone || "Asia/Jakarta",
  });
  const config = {
    model: input.model.trim(),
    ttsModel: input.ttsModel || "gemini-2.5-flash-preview-tts",
    budgetTimezone: input.budgetTimezone || "Asia/Jakarta",
  };
  return transaction(async (db) => {
    await db.query(
      `INSERT INTO integration_settings(tenant_id,kind,config) VALUES($1,'gemini',$2) ON CONFLICT(tenant_id,kind) DO UPDATE SET config=EXCLUDED.config,revision=integration_settings.revision+1`,
      [actor.tenantId, config],
    );
    await audit(db, actor, "settings.gemini_saved", {});
    return config;
  });
}
export async function addPoolKeys(actor, input) {
  requireIntegrationAdmin(actor);
  if (
    !input.projectName?.trim() ||
    !Number.isInteger(input.projectLimit) ||
    input.projectLimit < 1 ||
    input.projectLimit > 100000 ||
    !Array.isArray(input.keys) ||
    !input.keys.length ||
    input.keys.length > 100
  )
    throw new StudioError(
      "POOL_INPUT_INVALID",
      "Project, batas harian dan 1–100 key wajib.",
    );
  return transaction(async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      "cf-gemini-pool:" + actor.tenantId,
    ]);
    const projectId = input.projectId || randomUUID();
    const existing = (
      await db.query(
        "SELECT * FROM gemini_pool_projects WHERE tenant_id=$1 AND id=$2",
        [actor.tenantId, projectId],
      )
    ).rows[0];
    if (input.projectId && !existing)
      throw new StudioError("NOT_FOUND", "Project tidak ditemukan.", 404);
    if (!existing)
      await db.query(
        "INSERT INTO gemini_pool_projects(tenant_id,id,label,daily_limit) VALUES($1,$2,$3,$4)",
        [
          actor.tenantId,
          projectId,
          input.projectName.trim(),
          input.projectLimit,
        ],
      );
    let added = 0,
      duplicates = 0;
    for (const value of input.keys) {
      if (
        typeof value.apiKey !== "string" ||
        !value.apiKey.trim() ||
        !value.name?.trim()
      )
        throw new StudioError("KEY_INPUT_INVALID", "Nama dan key wajib.");
      const secret = value.apiKey.trim(),
        hash = createHash("sha256").update(secret).digest("hex");
      const found = await db.query(
        "SELECT 1 FROM gemini_pool_keys WHERE tenant_id=$1 AND key_hash=$2",
        [actor.tenantId, hash],
      );
      if (found.rowCount) {
        duplicates++;
        continue;
      }
      const id = randomUUID(),
        limit = Number(value.dailyLimit ?? input.projectLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100000)
        throw new StudioError("LIMIT_INVALID", "Batas key tidak valid.");
      await db.query(
        `INSERT INTO connections(id,tenant_id,kind,label,config,secret_ciphertext) VALUES($1,$2,'gemini',$3,$4,$5)`,
        [
          id,
          actor.tenantId,
          value.name.trim(),
          { baseUrl: "https://generativelanguage.googleapis.com/" },
          encryptSecret({ apiKey: secret }),
        ],
      );
      await db.query(
        "INSERT INTO gemini_pool_keys(tenant_id,id,connection_id,project_id,key_hash,name,masked,daily_limit) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          actor.tenantId,
          id,
          id,
          projectId,
          hash,
          value.name.trim(),
          "••••" + secret.slice(-4),
          limit,
        ],
      );
      added++;
    }
    await audit(db, actor, "gemini_pool.imported", {
      added,
      duplicates,
      projectId,
    });
    return { added, duplicates, projectId };
  });
}
export async function listPool(actor) {
  requireIntegrationAdmin(actor);
  const settings = await poolSettings(actor.tenantId),
    day = budgetDay(settings.budgetTimezone);
  const projects = (
    await getPool().query(
      `SELECT p.*,(SELECT count(*)::int FROM gemini_pool_attempts a WHERE a.tenant_id=p.tenant_id AND a.project_id=p.id AND a.budget_day=$2) AS used_today FROM gemini_pool_projects p WHERE tenant_id=$1 ORDER BY label`,
      [actor.tenantId, day],
    )
  ).rows;
  const keys = (
    await getPool().query(
      `SELECT k.id,k.project_id,k.name,k.masked,k.daily_limit,k.status,k.last_error_code,k.last_tested_at,(SELECT count(*)::int FROM gemini_pool_attempts a WHERE a.tenant_id=k.tenant_id AND a.key_id=k.id AND a.budget_day=$2) AS used_today FROM gemini_pool_keys k WHERE tenant_id=$1 AND status<>'archived' ORDER BY name`,
      [actor.tenantId, day],
    )
  ).rows;
  return { settings, projects, keys, budgetDay: day, localCounters: true };
}
export async function poolKeyState(actor, id, status) {
  requireIntegrationAdmin(actor);
  if (!["active", "disabled", "archived"].includes(status))
    throw new StudioError("STATUS_INVALID", "Status tidak valid.");
  const row = (
    await getPool().query(
      "UPDATE gemini_pool_keys SET status=$3 WHERE tenant_id=$1 AND id=$2 RETURNING id,status",
      [actor.tenantId, id, status],
    )
  ).rows[0];
  if (!row) throw new StudioError("NOT_FOUND", "Key tidak ditemukan.", 404);
  return row;
}
export async function reservePoolKey(tenantId, model, excluded = []) {
  const settings = await poolSettings(tenantId),
    day = budgetDay(settings.budgetTimezone);
  const reservation = await transaction(async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      "cf-gemini-pool:" + tenantId,
    ]);
    await db.query(
      `UPDATE gemini_pool_attempts SET status='unknown',error_code='WORKER_INTERRUPTED' WHERE tenant_id=$1 AND status='reserved' AND expires_at<now()`,
      [tenantId],
    );
    const candidate = (
      await db.query(
        `SELECT k.*,c.config,c.secret_ciphertext FROM gemini_pool_keys k JOIN gemini_pool_projects p ON p.tenant_id=k.tenant_id AND p.id=k.project_id JOIN connections c ON c.tenant_id=k.tenant_id AND c.id=k.connection_id WHERE k.tenant_id=$1 AND k.status='active' AND c.status='configured' AND NOT(k.id=ANY($3::text[])) AND (p.cooldown_until IS NULL OR p.cooldown_until<=now()) AND p.exhausted_day IS DISTINCT FROM $2 AND (SELECT count(*) FROM gemini_pool_attempts a WHERE a.tenant_id=p.tenant_id AND a.project_id=p.id AND a.budget_day=$2)<p.daily_limit AND (SELECT count(*) FROM gemini_pool_attempts a WHERE a.tenant_id=k.tenant_id AND a.key_id=k.id AND a.budget_day=$2)<k.daily_limit AND (SELECT count(*) FROM gemini_pool_attempts a WHERE a.tenant_id=p.tenant_id AND a.project_id=p.id AND a.status='reserved' AND a.expires_at>now())<p.max_concurrent ORDER BY (SELECT count(*) FROM gemini_pool_attempts a WHERE a.tenant_id=k.tenant_id AND a.key_id=k.id AND a.budget_day=$2),k.id LIMIT 1`,
        [tenantId, day, excluded],
      )
    ).rows[0];
    if (!candidate) return null;
    const attemptId = randomUUID();
    await db.query(
      "INSERT INTO gemini_pool_attempts(id,tenant_id,key_id,project_id,budget_day,model) VALUES($1,$2,$3,$4,$5,$6)",
      [attemptId, tenantId, candidate.id, candidate.project_id, day, model],
    );
    return {
      attemptId,
      keyId: candidate.id,
      projectId: candidate.project_id,
      day,
      connection: {
        id: candidate.connection_id,
        tenant_id: tenantId,
        kind: "gemini",
        config: { ...candidate.config, ...settings },
        secret: decryptSecret(candidate.secret_ciphertext),
      },
    };
  });
  if (!reservation)
    throw new StudioError(
      "GEMINI_POOL_UNAVAILABLE",
      "Tidak ada kapasitas pool yang siap. Tunggu cooldown atau periksa batas lokal.",
      503,
    );
  return reservation;
}
export async function finishPoolAttempt(reservation, error = null) {
  return transaction(async (db) => {
    const code = error?.code || null;
    await db.query(
      "UPDATE gemini_pool_attempts SET status=$2,error_code=$3 WHERE id=$1",
      [
        reservation.attemptId,
        error
          ? code === "PROVIDER_OUTCOME_UNKNOWN"
            ? "unknown"
            : "rejected"
          : "success",
        code,
      ],
    );
    if (["PROVIDER_AUTH_FAILED", "GEMINI_KEY_INVALID"].includes(code))
      await db.query(
        `UPDATE gemini_pool_keys SET status='invalid',last_error_code=$3 WHERE tenant_id=$1 AND id=$2`,
        [reservation.connection.tenant_id, reservation.keyId, code],
      );
    if (["PROVIDER_RATE_LIMIT", "GEMINI_QUOTA_EXHAUSTED"].includes(code))
      await db.query(
        `UPDATE gemini_pool_projects SET cooldown_until=now()+interval '60 seconds',exhausted_day=CASE WHEN $3='GEMINI_QUOTA_EXHAUSTED' THEN $4 ELSE exhausted_day END WHERE tenant_id=$1 AND id=$2`,
        [
          reservation.connection.tenant_id,
          reservation.projectId,
          code,
          reservation.day,
        ],
      );
  });
}
export async function executePool(tenantId, model, perform) {
  const has = (
    await getPool().query(
      `SELECT 1 FROM gemini_pool_keys WHERE tenant_id=$1 LIMIT 1`,
      [tenantId],
    )
  ).rowCount;
  if (!has) return { handled: false };
  const excluded = [];
  for (let n = 0; n < 3; n++) {
    const reservation = await reservePoolKey(tenantId, model, excluded);
    try {
      const result = await perform(reservation.connection);
      await finishPoolAttempt(reservation);
      return { handled: true, result };
    } catch (error) {
      await finishPoolAttempt(reservation, error);
      if (
        ![
          "PROVIDER_RATE_LIMIT",
          "GEMINI_QUOTA_EXHAUSTED",
          "PROVIDER_AUTH_FAILED",
          "GEMINI_KEY_INVALID",
        ].includes(error.code)
      )
        throw error;
      excluded.push(reservation.keyId);
    }
  }
  throw new StudioError(
    "GEMINI_POOL_UNAVAILABLE",
    "Pool belum dapat memproses permintaan.",
    503,
  );
}
export async function testPoolKeys(actor, id, fetcher = fetch) {
  requireIntegrationAdmin(actor);
  const rows = (
    await getPool().query(
      `SELECT k.id,k.status,c.config,c.secret_ciphertext FROM gemini_pool_keys k JOIN connections c ON c.tenant_id=k.tenant_id AND c.id=k.connection_id WHERE k.tenant_id=$1 AND k.status<>'archived' AND ($2::text IS NULL OR k.id=$2) LIMIT 100`,
      [actor.tenantId, id || null],
    )
  ).rows;
  const results = [];
  for (const key of rows) {
    let code = null,
      ok = false;
    try {
      const secret = decryptSecret(key.secret_ciphertext);
      const r = await fetcher(
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
        {
          headers: { "x-goog-api-key": secret.apiKey },
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        },
      );
      let value = {};
      try {
        value = await r.json();
      } catch {}
      const reasons = JSON.stringify(value.error?.details || []);
      ok = r.ok;
      code = ok
        ? null
        : r.status === 401 || reasons.includes("API_KEY_INVALID")
          ? "GEMINI_KEY_INVALID"
          : r.status === 403
            ? "PROVIDER_PERMISSION_DENIED"
            : r.status === 429
              ? "PROVIDER_RATE_LIMIT"
              : "PROVIDER_UNAVAILABLE";
    } catch {
      code = "PROVIDER_UNAVAILABLE";
    }
    await getPool().query(
      `UPDATE gemini_pool_keys SET last_tested_at=now(),last_error_code=$3,status=CASE WHEN $3='GEMINI_KEY_INVALID' THEN 'invalid' WHEN $4::boolean AND status='invalid' THEN 'disabled' ELSE status END WHERE tenant_id=$1 AND id=$2`,
      [actor.tenantId, key.id, code, ok],
    );
    results.push({ id: key.id, ok, errorCode: code });
  }
  return { results };
}
