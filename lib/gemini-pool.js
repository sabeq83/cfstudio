import { modelConfig, validateModelConfig } from "./gemini-models.js";
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
  const row =
    (
      await getPool().query(
        "SELECT config FROM integration_settings WHERE tenant_id=$1 AND kind='gemini'",
        [tenantId],
      )
    ).rows[0]?.config || {};
  return { ...row, ...modelConfig(row) };
}
export async function savePoolSettings(actor, input) {
  requireIntegrationAdmin(actor);
  const policy = validateModelConfig(input);
  return transaction(async (db) => {
    const old =
      (
        await db.query(
          "SELECT config FROM integration_settings WHERE tenant_id=$1 AND kind='gemini' FOR UPDATE",
          [actor.tenantId],
        )
      ).rows[0]?.config || {};
    const config = { ...old, ...policy };
    await db.query(
      `INSERT INTO integration_settings(tenant_id,kind,config) VALUES($1,'gemini',$2) ON CONFLICT(tenant_id,kind) DO UPDATE SET config=EXCLUDED.config,revision=integration_settings.revision+1`,
      [actor.tenantId, config],
    );
    await audit(db, actor, "settings.gemini_saved", {});
    return config;
  });
}
export async function probePoolKey(secret, fetcher = fetch) {
  try {
    const r = await fetcher(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
      {
        headers: { "x-goog-api-key": secret },
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      },
    );
    let v = {};
    try {
      v = await r.json();
    } catch {
      return { ok: false, errorCode: "PROVIDER_UNAVAILABLE" };
    }
    const reasons = JSON.stringify(v.error?.details || []);
    return {
      ok: r.ok,
      errorCode: r.ok
        ? null
        : r.status === 401 || reasons.includes("API_KEY_INVALID")
          ? "GEMINI_KEY_INVALID"
          : r.status === 403
            ? "PROVIDER_PERMISSION_DENIED"
            : r.status === 429
              ? "PROVIDER_RATE_LIMIT"
              : "PROVIDER_UNAVAILABLE",
    };
  } catch {
    return { ok: false, errorCode: "PROVIDER_UNAVAILABLE" };
  }
}
export async function addPoolKeys(actor, input, fetcher = fetch) {
  requireIntegrationAdmin(actor);
  if (
    !Array.isArray(input.keys) ||
    !input.keys.length ||
    input.keys.length > 100
  )
    throw new StudioError("POOL_INPUT_INVALID", "Isi 1–100 key.");
  const entries = input.keys.map((v) => {
    const limit = Number(v.dailyLimit ?? 20);
    if (
      typeof v.apiKey !== "string" ||
      !v.apiKey.trim() ||
      v.apiKey.length > 4096 ||
      typeof v.name !== "string" ||
      !v.name.trim() ||
      v.name.length > 120 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100000
    )
      throw new StudioError(
        "KEY_INPUT_INVALID",
        "Alias, key dan batas harian 1–100000 wajib.",
      );
    return {
      name: v.name.trim(),
      secret: v.apiKey.trim(),
      limit,
      hash: createHash("sha256").update(v.apiKey.trim()).digest("hex"),
    };
  });
  const results = [];
  let added = 0,
    duplicates = 0,
    rejected = 0,
    failed = 0;
  for (const entry of entries) {
    const found = (
      await getPool().query(
        "SELECT 1 FROM gemini_pool_keys WHERE tenant_id=$1 AND key_hash=$2",
        [actor.tenantId, entry.hash],
      )
    ).rowCount;
    if (found) {
      duplicates++;
      results.push({ name: entry.name, status: "duplicate" });
      continue;
    }
    const check =
      input.validateLive === true
        ? await probePoolKey(entry.secret, fetcher)
        : null;
    if (check && !check.ok) {
      const invalid = check.errorCode === "GEMINI_KEY_INVALID";
      invalid ? rejected++ : failed++;
      results.push({
        name: entry.name,
        status: invalid ? "rejected" : "check_failed",
        errorCode: check.errorCode,
      });
      continue;
    }
    const saved = await transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "cf-gemini-pool:" + actor.tenantId,
      ]);
      if (
        (
          await db.query(
            "SELECT 1 FROM gemini_pool_keys WHERE tenant_id=$1 AND key_hash=$2",
            [actor.tenantId, entry.hash],
          )
        ).rowCount
      )
        return false;
      const id = randomUUID();
      await db.query(
        `INSERT INTO connections(id,tenant_id,kind,label,config,secret_ciphertext) VALUES($1,$2,'gemini',$3,$4,$5)`,
        [
          id,
          actor.tenantId,
          entry.name,
          { baseUrl: "https://generativelanguage.googleapis.com/" },
          encryptSecret({ apiKey: entry.secret }),
        ],
      );
      await db.query(
        `INSERT INTO gemini_pool_keys(tenant_id,id,connection_id,key_hash,name,masked,daily_limit,status,last_tested_at) VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8)`,
        [
          actor.tenantId,
          id,
          entry.hash,
          entry.name,
          "••••" + entry.secret.slice(-4),
          entry.limit,
          check ? "active" : "disabled",
          check ? new Date() : null,
        ],
      );
      return true;
    });
    saved ? added++ : duplicates++;
    results.push({
      name: entry.name,
      status: saved ? (check ? "added" : "added_paused") : "duplicate",
    });
  }
  await transaction((db) =>
    audit(db, actor, "gemini_pool.imported", {
      added,
      duplicates,
      rejected,
      failed,
    }),
  );
  return { added, duplicates, rejected, failed, results };
}
export async function listPool(actor) {
  requireIntegrationAdmin(actor);
  const settings = await poolSettings(actor.tenantId),
    day = budgetDay(settings.budgetTimezone);
  const all = (
    await getPool().query(
      `SELECT k.id,k.name,k.masked,k.daily_limit,k.status,k.last_error_code,k.last_tested_at,k.cooldown_until,k.exhausted_day,(SELECT count(*)::int FROM gemini_pool_attempts a WHERE a.tenant_id=k.tenant_id AND a.key_id=k.id AND a.budget_day=$2) AS used_today FROM gemini_pool_keys k WHERE tenant_id=$1 ORDER BY name,id`,
      [actor.tenantId, day],
    )
  ).rows;
  const state = (k) =>
    k.status === "invalid"
      ? "invalid"
      : k.status === "disabled"
        ? "paused"
        : k.exhausted_day === day || k.used_today >= k.daily_limit
          ? "limit"
          : k.cooldown_until && new Date(k.cooldown_until) > new Date()
            ? "cooldown"
            : k.last_error_code &&
                !["PROVIDER_RATE_LIMIT", "GEMINI_QUOTA_EXHAUSTED"].includes(
                  k.last_error_code,
                )
              ? "temporary"
              : "active";
  const keys = all
      .filter((k) => k.status !== "archived")
      .map((k) => ({ ...k, display_status: state(k) })),
    archived = all.filter((k) => k.status === "archived");
  return {
    settings,
    keys,
    archived,
    budgetDay: day,
    localCounters: true,
    summary: {
      activeKeys: keys.filter((k) => k.display_status === "active").length,
      totalKeys: keys.length,
      used: keys.reduce((n, k) => n + k.used_today, 0),
      capacity: keys.reduce((n, k) => n + k.daily_limit, 0),
      remaining: keys.reduce(
        (n, k) => n + Math.max(0, k.daily_limit - k.used_today),
        0,
      ),
    },
  };
}
export async function poolKeyState(actor, id, status) {
  requireIntegrationAdmin(actor);
  if (!["active", "disabled", "archived"].includes(status))
    throw new StudioError("STATUS_INVALID", "Status tidak valid.");
  return transaction(async (db) => {
    const k = (
      await db.query(
        "SELECT * FROM gemini_pool_keys WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [actor.tenantId, id],
      )
    ).rows[0];
    if (!k) throw new StudioError("NOT_FOUND", "Key tidak ditemukan.", 404);
    const next =
      k.status === "archived" && status !== "archived" ? "disabled" : status;
    if (
      next === "active" &&
      (k.status === "invalid" || k.last_error_code === "GEMINI_KEY_INVALID")
    )
      throw new StudioError(
        "KEY_RETEST_REQUIRED",
        "Tes ulang key invalid sebelum mengaktifkan.",
      );
    const row = (
      await db.query(
        "UPDATE gemini_pool_keys SET status=$3 WHERE tenant_id=$1 AND id=$2 RETURNING id,status",
        [actor.tenantId, id, next],
      )
    ).rows[0];
    await audit(db, actor, "gemini_pool.state_changed", { id, status: next });
    return row;
  });
}
export async function archiveInvalidKeys(actor) {
  requireIntegrationAdmin(actor);
  return transaction(async (db) => {
    const r = await db.query(
      "UPDATE gemini_pool_keys SET status='archived' WHERE tenant_id=$1 AND status='invalid' RETURNING id",
      [actor.tenantId],
    );
    await audit(db, actor, "gemini_pool.invalid_archived", {
      count: r.rowCount,
    });
    return { archived: r.rowCount };
  });
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
        `SELECT k.*,c.config,c.secret_ciphertext FROM gemini_pool_keys k JOIN connections c ON c.tenant_id=k.tenant_id AND c.id=k.connection_id WHERE k.tenant_id=$1 AND k.status='active' AND c.status='configured' AND NOT(k.id=ANY($3::text[])) AND (k.cooldown_until IS NULL OR k.cooldown_until<=now()) AND k.exhausted_day IS DISTINCT FROM $2 AND (SELECT count(*) FROM gemini_pool_attempts a WHERE a.tenant_id=k.tenant_id AND a.key_id=k.id AND a.budget_day=$2)<k.daily_limit AND (SELECT count(*) FROM gemini_pool_attempts a WHERE a.tenant_id=k.tenant_id AND a.key_id=k.id AND a.status='reserved' AND a.expires_at>now())<k.max_concurrent ORDER BY (SELECT count(*) FROM gemini_pool_attempts a WHERE a.tenant_id=k.tenant_id AND a.key_id=k.id AND a.budget_day=$2),k.id LIMIT 1`,
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
    if (!error)
      await db.query(
        "UPDATE gemini_pool_keys SET last_error_code=NULL WHERE tenant_id=$1 AND id=$2",
        [reservation.connection.tenant_id, reservation.keyId],
      );
    if (["PROVIDER_AUTH_FAILED", "GEMINI_KEY_INVALID"].includes(code))
      await db.query(
        `UPDATE gemini_pool_keys SET status='invalid',last_error_code=$3 WHERE tenant_id=$1 AND id=$2`,
        [reservation.connection.tenant_id, reservation.keyId, code],
      );
    if (["PROVIDER_RATE_LIMIT", "GEMINI_QUOTA_EXHAUSTED"].includes(code))
      await db.query(
        `UPDATE gemini_pool_keys SET cooldown_until=now()+interval '60 seconds',last_error_code=$3,exhausted_day=CASE WHEN $3='GEMINI_QUOTA_EXHAUSTED' THEN $4 ELSE exhausted_day END WHERE tenant_id=$1 AND id=$2`,
        [
          reservation.connection.tenant_id,
          reservation.keyId,
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
      `SELECT k.id,k.status,c.secret_ciphertext FROM gemini_pool_keys k JOIN connections c ON c.tenant_id=k.tenant_id AND c.id=k.connection_id WHERE k.tenant_id=$1 AND k.status<>'archived' AND ($2::text IS NULL OR k.id=$2) ORDER BY k.id LIMIT 100`,
      [actor.tenantId, id || null],
    )
  ).rows;
  const results = [];
  for (const key of rows) {
    const { ok, errorCode } = await probePoolKey(
      decryptSecret(key.secret_ciphertext).apiKey,
      fetcher,
    );
    await getPool().query(
      `UPDATE gemini_pool_keys SET last_tested_at=now(),last_error_code=$3,cooldown_until=CASE WHEN $3='PROVIDER_RATE_LIMIT' THEN now()+interval '60 seconds' ELSE cooldown_until END,status=CASE WHEN $3='GEMINI_KEY_INVALID' THEN 'invalid' WHEN $4::boolean AND status='invalid' THEN 'disabled' ELSE status END WHERE tenant_id=$1 AND id=$2`,
      [actor.tenantId, key.id, errorCode, ok],
    );
    results.push({ id: key.id, ok, errorCode });
  }
  return { results };
}
