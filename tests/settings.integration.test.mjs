import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { setTestDatabase, getPool } from "../lib/db-pg.js";
import {
  addPoolKeys,
  listPool,
  savePoolSettings,
  reservePoolKey,
  finishPoolAttempt,
  executePool,
  poolKeyState,
  testPoolKeys,
  archiveInvalidKeys,
} from "../lib/gemini-pool.js";
import {
  saveProviderSettings,
  productionDefaults,
  reserveGlabsLane,
} from "../lib/provider-settings.js";
import { decryptSecret, resolveConnection } from "../lib/connections.js";
import { ProviderGateway } from "../lib/provider-gateway.js";
import {
  saveGoogleConfig,
  googleStatus,
  startGoogleOAuth,
  finishGoogleOAuth,
  ensureDriveFolder,
  verifyDrive,
  disconnectGoogle,
  setGoogleTestFetch,
  stagePublishingMedia,
  cleanupPublishingMedia,
} from "../lib/google-drive.js";
import { saveArtifact, loadArtifact } from "../lib/artifact-store.js";
import { fakeGoogle, installFakeDrive } from "./helpers/fake-google.mjs";
let pg, dir, fake, drive, pool;
const actor = {
  id: "admin",
  tenantId: "a",
  status: "active",
  tenantStatus: "active",
  allBrands: true,
  brandIds: [],
  capabilities: ["integration.manage"],
};
const other = { ...actor, id: "admin-b", tenantId: "b" };
const json = (v, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });
before(async () => {
  process.env.NODE_ENV = "test";
  process.env.CF_MASTER_KEY_B64 = randomBytes(32).toString("base64");
  process.env.ENABLE_PRODUCTION_DISPATCH = "true";
  process.env.ENABLE_PUBLISHING_DISPATCH = "true";
  process.env.CF_PUBLIC_BASE_URL = "http://127.0.0.1:3100";
  dir = await mkdtemp(path.join(os.tmpdir(), "cf-settings-"));
  process.env.CF_STORAGE_ROOT = dir;
  pg = new PGlite();
  for (const n of (
    await readdir(new URL("../db/migrations/", import.meta.url))
  ).sort())
    await pg.exec(
      await readFile(new URL("../db/migrations/" + n, import.meta.url), "utf8"),
    );
  const query = async (sql, args) => {
    const r = await pg.query(sql, args);
    return { ...r, rowCount: r.rows.length || r.affectedRows || 0 };
  };
  setTestDatabase({ query, connect: async () => ({ query, release() {} }) });
  await pg.exec(
    "INSERT INTO tenants(id,name) VALUES('a','A'),('b','B');INSERT INTO users(id,tenant_id,username,password_hash,all_brands,capabilities) VALUES('admin','a','admin','TEST_MOCK_HASH',true,'[\"integration.manage\"]'),('admin-b','b','admin','TEST_MOCK_HASH',true,'[\"integration.manage\"]');INSERT INTO catalog_items(id,tenant_id,domain,name) VALUES('brand','a','brand','A');INSERT INTO routines(id,tenant_id,brand_id,draft) VALUES('routine','a','brand','{}');INSERT INTO automation_runs(id,tenant_id,routine_id,execution_mode,config) VALUES('run','a','routine','once','{}');",
  );
  fake = fakeGoogle();
  setGoogleTestFetch(fake.fetcher);
});
after(async () => {
  setGoogleTestFetch(null);
  setTestDatabase(null);
  await pg.close();
  await rm(dir, { recursive: true, force: true });
});
async function resetPool() {
  await pg.exec(
    "DELETE FROM gemini_context_caches;DELETE FROM gemini_pool_attempts;DELETE FROM gemini_pool_keys;DELETE FROM gemini_pool_projects;DELETE FROM connections WHERE kind='gemini';",
  );
}
async function add(
  project = "P",
  limit = 5,
  keys = ["TEST_MOCK_KEY_ONE", "TEST_MOCK_KEY_TWO"],
) {
  return addPoolKeys(
    actor,
    {
      validateLive: true,
      keys: keys.map((apiKey, i) => ({
        name: "Key " + i,
        apiKey,
        dailyLimit: limit,
      })),
    },
    async () => json({ models: [] }),
  );
}
test("Gemini bulk import is encrypted, deduplicated, masked and tenant scoped", async () => {
  pool = await add();
  assert.equal(pool.added, 2);
  assert.equal((await add()).duplicates, 2);
  const view = await listPool(actor);
  assert.equal(view.keys.length, 2);
  assert.equal((await listPool(other)).keys.length, 0);
  assert.ok(!JSON.stringify(view).includes("TEST_MOCK_KEY_ONE"));
  const c = (
    await pg.query(
      "SELECT secret_ciphertext FROM connections WHERE kind='gemini' LIMIT 1",
    )
  ).rows[0];
  assert.ok(!c.secret_ciphertext.includes("TEST_MOCK"));
  assert.ok(decryptSecret(c.secret_ciphertext).apiKey);
  await assert.rejects(
    () =>
      addPoolKeys(
        { ...actor, allBrands: false },
        { projectName: "X", projectLimit: 1, keys: [] },
      ),
    { code: "GLOBAL_CONNECTION_DENIED" },
  );
  await assert.rejects(() => poolKeyState(other, view.keys[0].id, "archived"), {
    code: "NOT_FOUND",
  });
});
test("per-key budget and concurrency stay independent; interrupted reservations remain counted", async () => {
  await resetPool();
  await add("Shared", 2);
  const r1 = await reservePoolKey("a", "model"),
    r2 = await reservePoolKey("a", "model");
  assert.notEqual(r1.keyId, r2.keyId);
  await reservePoolKey("a", "model");
  await reservePoolKey("a", "model");
  await assert.rejects(() => reservePoolKey("a", "model"), {
    code: "GEMINI_POOL_UNAVAILABLE",
  });
  await pg.exec(
    "UPDATE gemini_pool_attempts SET expires_at=now()-interval '1 second'",
  );
  await assert.rejects(() => reservePoolKey("a", "model"), {
    code: "GEMINI_POOL_UNAVAILABLE",
  });
  assert.equal(
    (
      await pg.query(
        "SELECT count(*)::int n FROM gemini_pool_attempts WHERE status='unknown'",
      )
    ).rows[0].n,
    4,
  );
});
test("rate limit cools one key without invalidating it; another key may rotate", async () => {
  await resetPool();
  await add("First", 9, ["TEST_MOCK_FIRST"]);
  await add("Second", 9, ["TEST_MOCK_SECOND"]);
  let calls = 0;
  const result = await executePool("a", "model", async () => {
    if (++calls === 1)
      throw Object.assign(new Error("rate"), { code: "PROVIDER_RATE_LIMIT" });
    return "done";
  });
  assert.equal(result.result, "done");
  assert.equal(calls, 2);
  const view = await listPool(actor);
  assert.ok(view.keys.every((k) => k.status === "active"));
  assert.equal(view.keys.filter((p) => p.cooldown_until).length, 1);
});
test("ambiguous Gemini POST never rotates; archived pool never falls back to hidden legacy key", async () => {
  await resetPool();
  await add();
  let calls = 0;
  await assert.rejects(
    () =>
      executePool("a", "model", async () => {
        calls++;
        throw Object.assign(new Error("lost"), {
          code: "PROVIDER_OUTCOME_UNKNOWN",
        });
      }),
    { code: "PROVIDER_OUTCOME_UNKNOWN" },
  );
  assert.equal(calls, 1);
  for (const k of (await listPool(actor)).keys)
    await poolKeyState(actor, k.id, "archived");
  await assert.rejects(
    () =>
      executePool("a", "model", async () => {
        calls++;
      }),
    { code: "GEMINI_POOL_UNAVAILABLE" },
  );
  assert.equal(calls, 1);
});
test("health check distinguishes 429, permission denial and invalid key without returning raw response", async () => {
  await resetPool();
  await add();
  const key = (await listPool(actor)).keys[0];
  for (const [status, body, code, state] of [
    [429, {}, "PROVIDER_RATE_LIMIT", "active"],
    [403, {}, "PROVIDER_PERMISSION_DENIED", "active"],
    [
      400,
      { error: { details: [{ reason: "API_KEY_INVALID" }] } },
      "GEMINI_KEY_INVALID",
      "invalid",
    ],
  ]) {
    const result = await testPoolKeys(actor, key.id, async () =>
      json(body, status),
    );
    assert.equal(result.results[0].errorCode, code);
    assert.equal(
      (await listPool(actor)).keys.find((k) => k.id === key.id).status,
      state,
    );
    assert.ok(!JSON.stringify(result).includes("TEST_MOCK"));
  }
  await testPoolKeys(actor, key.id, async () => json({ models: [] }));
  assert.equal(
    (await listPool(actor)).keys.find((k) => k.id === key.id).status,
    "disabled",
  );
});
test("TTS and planner use same durable pool and keep frozen model override", async () => {
  await resetPool();
  await add();
  await savePoolSettings(actor, {
    model: "planner-model",
    ttsModel: "tts-model",
  });
  let url;
  const gateway = new ProviderGateway({
    fetcher: async (u) => {
      url = String(u);
      return json({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "audio/wav",
                    data: Buffer.from("audio").toString("base64"),
                  },
                },
              ],
            },
          },
        ],
      });
    },
  });
  await gateway.gemini(await resolveConnection("a", null, "gemini"), "Hello", {
    audio: true,
    model: "frozen-tts",
    voice: "Puck",
  });
  assert.ok(url.includes("frozen-tts"));
  assert.equal(
    (await pg.query("SELECT count(*)::int n FROM gemini_pool_attempts")).rows[0]
      .n,
    1,
  );
});
test("provider saves preserve blank credentials and freeze defaults beneath presets", async () => {
  await saveProviderSettings(actor, {
    kind: "minimax",
    config: {
      baseUrl: "https://api.minimax.io/",
      model: "voice-model",
      voice: "voice-a",
      fallback: false,
      apiKey: "SHOULD_NOT_STORE",
    },
    secret: { apiKey: "TEST_MOCK_MINIMAX" },
  });
  await saveProviderSettings(actor, {
    kind: "minimax",
    config: {
      baseUrl: "https://api.minimax.io/",
      model: "voice-model-2",
      voice: "voice-b",
      fallback: false,
    },
    secret: { apiKey: "" },
  });
  const c = await resolveConnection("a", null, "minimax");
  assert.equal(c.secret.apiKey, "TEST_MOCK_MINIMAX");
  assert.equal(c.config.apiKey, undefined);
  const defaults = await productionDefaults(getPool(), "a");
  assert.equal(defaults.workflow.voice_persona, "voice-b");
  assert.equal(defaults.workflow.gemini_fallback_enabled, false);
  await assert.rejects(
    () =>
      saveProviderSettings(actor, {
        kind: "glabs",
        config: { delayMin: 30, delayMax: 10 },
      }),
    { code: "GLABS_SETTING_INVALID" },
  );
});
test("G-Labs safety delay persists instead of blocking a worker", async () => {
  await saveProviderSettings(actor, {
    kind: "glabs",
    config: {
      baseUrl: "http://127.0.0.1:8765/",
      delayMin: 15,
      delayMax: 15,
      maxConcurrent: 2,
      t2iPattern: "threading",
    },
    secret: { apiKey: "TEST_MOCK_GLABS" },
  });
  const c = await resolveConnection("a", null, "glabs");
  await reserveGlabsLane({ ...c, tenant_id: "a" });
  await assert.rejects(() => reserveGlabsLane({ ...c, tenant_id: "a" }), {
    code: "GLABS_PACING_WAIT",
  });
});
test("Google OAuth binds nonce, actor and tenant, consumes state once and encrypts offline tokens", async () => {
  const c = await saveGoogleConfig(actor, {
    clientId: "TEST_MOCK_CLIENT",
    clientSecret: "TEST_MOCK_SECRET",
  });
  const start = await startGoogleOAuth(actor, c.id);
  const state = new URL(start.authUrl).searchParams.get("state");
  assert.equal(
    new URL(start.authUrl).searchParams.get("access_type"),
    "offline",
  );
  await assert.rejects(() => startGoogleOAuth(other, c.id), {
    code: "GOOGLE_CONFIG_REQUIRED",
  });
  await assert.rejects(
    () => finishGoogleOAuth({ state, nonce: "wrong", code: "TEST_MOCK_CODE" }),
    { code: "OAUTH_STATE_INVALID" },
  );
  await finishGoogleOAuth({
    state,
    nonce: start.nonce,
    code: "TEST_MOCK_CODE",
  });
  await assert.rejects(
    () =>
      finishGoogleOAuth({ state, nonce: start.nonce, code: "TEST_MOCK_CODE" }),
    { code: "OAUTH_STATE_INVALID" },
  );
  const row = (await pg.query("SELECT * FROM connections WHERE id=$1", [c.id]))
    .rows[0];
  assert.equal(row.status, "configured");
  assert.equal(
    decryptSecret(row.secret_ciphertext).refreshToken,
    "TEST_MOCK_REFRESH_TOKEN",
  );
  assert.ok(
    !JSON.stringify(await googleStatus(actor)).includes(
      "TEST_MOCK_REFRESH_TOKEN",
    ),
  );
  drive = { id: c.id };
  await ensureDriveFolder(actor, c.id);
  drive.folderId = (
    await pg.query("SELECT config FROM connections WHERE id=$1", [c.id])
  ).rows[0].config.folderId;
  await verifyDrive(actor, c.id);
});
test("OAuth callback rechecks revoked permissions and expires stale state", async () => {
  const start = await startGoogleOAuth(actor, drive.id),
    state = new URL(start.authUrl).searchParams.get("state");
  await pg.exec("UPDATE users SET capabilities='[]' WHERE id='admin'");
  await assert.rejects(
    () =>
      finishGoogleOAuth({ state, nonce: start.nonce, code: "TEST_MOCK_CODE" }),
    { code: "CAPABILITY_REQUIRED" },
  );
  await pg.exec(
    "UPDATE users SET capabilities='[\"integration.manage\"]' WHERE id='admin'",
  );
  const next = await startGoogleOAuth(actor, drive.id);
  await pg.exec(
    "UPDATE google_oauth_states SET expires_at=now()-interval '1 second'",
  );
  await assert.rejects(
    () =>
      finishGoogleOAuth({
        state: new URL(next.authUrl).searchParams.get("state"),
        nonce: next.nonce,
        code: "TEST_MOCK_CODE",
      }),
    { code: "OAUTH_STATE_INVALID" },
  );
});
test("Drive folder ownership is tenant scoped and refresh tokens are renewed encrypted", async () => {
  const foreign = await installFakeDrive(other, fake);
  await saveGoogleConfig(actor, {
    clientId: "TEST_MOCK_CLIENT",
    folderId: foreign.folderId,
  });
  await assert.rejects(() => verifyDrive(actor, drive.id), {
    code: "GOOGLE_FOLDER_TENANT_MISMATCH",
  });
  await saveGoogleConfig(actor, {
    clientId: "TEST_MOCK_CLIENT",
    folderId: drive.folderId,
  });
  const row = (
      await pg.query("SELECT * FROM connections WHERE id=$1", [drive.id])
    ).rows[0],
    secret = decryptSecret(row.secret_ciphertext);
  await pg.query("UPDATE connections SET secret_ciphertext=$2 WHERE id=$1", [
    drive.id,
    (await import("../lib/connections.js")).encryptSecret({
      ...secret,
      expiresAt: 0,
    }),
  ]);
  await verifyDrive(actor, drive.id);
  assert.ok(
    fake.requests.filter((r) => r.host === "oauth2.googleapis.com").length >= 2,
  );
});
async function artifact(id) {
  await pg.query(
    "INSERT INTO content_items(id,tenant_id,run_id,brand_id,status) VALUES($1,'a','run','brand','ready')",
    [id],
  );
  const asset = await saveArtifact({
    tenantId: "a",
    brandId: "brand",
    objectId: id,
    revision: 1,
    kind: "final",
    buffer: Buffer.from("binary final media " + id),
    mimeType: "video/mp4",
    extension: "mp4",
  });
  return { item: { id, revision: 1 }, asset };
}
test("lost Drive upload response recovers same generated ID without duplicate upload", async () => {
  const { item, asset } = await artifact("recover");
  fake.faults.uploadLost = true;
  const before = fake.uploads;
  await assert.rejects(
    () =>
      stagePublishingMedia(
        actor,
        item,
        asset,
        new Date(Date.now() + 86400000),
        "w1",
      ),
    { code: "GOOGLE_OUTCOME_UNKNOWN" },
  );
  const copy = await stagePublishingMedia(
    actor,
    item,
    asset,
    new Date(Date.now() + 40 * 86400000),
    "w2",
  );
  assert.equal(fake.uploads, before + 1);
  assert.equal(
    (
      await pg.query("SELECT status FROM publishing_media WHERE id=$1", [
        copy.id,
      ])
    ).rows[0].status,
    "verified",
  );
  assert.ok(new Date(copy.expiresAt) > Date.now() + 41 * 86400000);
  assert.equal(
    (await loadArtifact("a", asset.id)).buffer.toString(),
    "binary final media recover",
  );
  const again = await stagePublishingMedia(
    actor,
    item,
    asset,
    new Date(Date.now() + 86400000),
    "w3",
  );
  assert.equal(copy.id, again.id);
  assert.equal(fake.uploads, before + 1);
});
test("Drive public probe rejects HTML and forbidden public permissions; no verified URL escapes", async () => {
  const a = await artifact("html");
  fake.faults.html = true;
  await assert.rejects(
    () =>
      stagePublishingMedia(
        actor,
        a.item,
        a.asset,
        new Date(Date.now() + 86400000),
        "w",
      ),
    { code: "DRIVE_DOWNLOAD_NOT_PUBLIC" },
  );
  fake.faults.html = false;
  const b = await artifact("policy");
  fake.faults.permissionDenied = true;
  await assert.rejects(
    () =>
      stagePublishingMedia(
        actor,
        b.item,
        b.asset,
        new Date(Date.now() + 86400000),
        "w",
      ),
    { code: "GOOGLE_PERMISSION_DENIED" },
  );
  fake.faults.permissionDenied = false;
  assert.equal(
    (
      await pg.query(
        "SELECT count(*)::int n FROM publishing_media WHERE item_id IN('html','policy') AND status='verified'",
      )
    ).rows[0].n,
    0,
  );
});
test("retention cleanup trashes only owned staging copy and preserves original final artifact", async () => {
  const { item, asset } = await artifact("cleanup");
  const copy = await stagePublishingMedia(
    actor,
    item,
    asset,
    new Date(Date.now() + 86400000),
    "w",
  );
  await pg.query(
    "UPDATE publishing_media SET expires_at=now()-interval '1 second' WHERE id=$1",
    [copy.id],
  );
  await cleanupPublishingMedia("cleaner");
  assert.equal(fake.files.get(copy.fileId).trashed, true);
  assert.equal(fake.files.get(copy.fileId).permissions.length, 0);
  assert.equal((await loadArtifact("a", asset.id)).asset.sha256, asset.sha256);
});
test("cleanup also retires a public copy whose anonymous probe failed", async () => {
  const row = (
    await pg.query("SELECT * FROM publishing_media WHERE item_id='html'")
  ).rows[0];
  assert.equal(row.permission_id, null);
  assert.ok(fake.files.get(row.file_id).permissions.length);
  await pg.query(
    "UPDATE publishing_media SET expires_at=now()-interval '1 second' WHERE id=$1",
    [row.id],
  );
  await cleanupPublishingMedia("cleanup-failed-probe");
  assert.equal(fake.files.get(row.file_id).trashed, true);
  assert.equal(fake.files.get(row.file_id).permissions.length, 0);
});
test("unknown publishing outcome holds Drive copy and blocks disconnect until reconciled", async () => {
  const { item, asset } = await artifact("hold");
  const copy = await stagePublishingMedia(
    actor,
    item,
    asset,
    new Date(Date.now() + 86400000),
    "w",
  );
  await pg.query(
    "INSERT INTO approvals(tenant_id,item_id,revision,actor_id) VALUES('a',$1,1,'admin')",
    [item.id],
  );
  await pg.query(
    "INSERT INTO publishing_intents(id,tenant_id,item_id,revision,account_id,scheduled_at,status,media_id) VALUES('hold-intent','a',$1,1,'account',now(),'unknown',$2)",
    [item.id, copy.id],
  );
  await pg.query(
    "UPDATE publishing_media SET expires_at=now()-interval '1 second' WHERE id=$1",
    [copy.id],
  );
  assert.equal(await cleanupPublishingMedia("cleaner"), false);
  assert.equal(fake.files.get(copy.fileId).trashed, false);
  await assert.rejects(() => disconnectGoogle(actor, drive.id), {
    code: "PUBLISHING_ACTIVE",
  });
  await pg.exec(
    "UPDATE publishing_intents SET status='canceled' WHERE id='hold-intent'",
  );
  assert.equal(await cleanupPublishingMedia("cleaner"), true);
  assert.equal(fake.files.get(copy.fileId).trashed, true);
});
test("disconnect removes public copies and offline tokens but keeps encrypted OAuth client for reconnect", async () => {
  const result = await disconnectGoogle(actor, drive.id);
  assert.ok(result.disconnected);
  const c = (
    await pg.query("SELECT * FROM connections WHERE id=$1", [drive.id])
  ).rows[0];
  assert.equal(c.status, "disconnected");
  assert.equal(decryptSecret(c.secret_ciphertext).refreshToken, undefined);
  assert.equal(decryptSecret(c.secret_ciphertext).clientId, "TEST_MOCK_CLIENT");
  assert.ok(
    [...fake.files.values()]
      .filter(
        (f) =>
          f.appProperties?.cfTenantId === "a" && f.mimeType === "video/mp4",
      )
      .every((f) => f.trashed),
  );
  await startGoogleOAuth(actor, drive.id);
});

test("bulk live validation counts duplicates, invalid and transient failures without raw key exposure", async () => {
  await resetPool();
  const keys = [
    "TEST_MOCK_GOOD",
    "TEST_MOCK_BAD",
    "TEST_MOCK_TEMP",
    "TEST_MOCK_GOOD",
  ].map((apiKey, i) => ({ name: "Import " + i, apiKey, dailyLimit: 20 }));
  const result = await addPoolKeys(
    actor,
    { keys, validateLive: true },
    async (u, o) =>
      o.headers["x-goog-api-key"].includes("BAD")
        ? json({ error: { details: [{ reason: "API_KEY_INVALID" }] } }, 400)
        : o.headers["x-goog-api-key"].includes("TEMP")
          ? json({}, 503)
          : json({ models: [] }),
  );
  assert.deepEqual(
    [result.added, result.duplicates, result.rejected, result.failed],
    [1, 1, 1, 1],
  );
  assert.ok(!JSON.stringify(result).includes("TEST_MOCK_GOOD"));
  const view = await listPool(actor);
  assert.equal(view.summary.capacity, 20);
  assert.equal(view.projects, undefined);
  assert.equal(
    (await pg.query("SELECT project_id FROM gemini_pool_keys")).rows[0]
      .project_id,
    null,
  );
  const paused = await addPoolKeys(actor, {
    keys: [{ name: "Paused", apiKey: "TEST_MOCK_PAUSED", dailyLimit: 7 }],
    validateLive: false,
  });
  assert.equal(paused.added, 1);
  assert.equal(
    (await listPool(actor)).keys.find((k) => k.name === "Paused").status,
    "disabled",
  );
});
test("invalid cleanup preserves archived history and restores paused; invalid keys require successful retest", async () => {
  const keys = (await listPool(actor)).keys;
  await testPoolKeys(actor, keys[0].id, async () =>
    json({ error: { details: [{ reason: "API_KEY_INVALID" }] } }, 400),
  );
  await assert.rejects(() => poolKeyState(actor, keys[0].id, "active"), {
    code: "KEY_RETEST_REQUIRED",
  });
  assert.equal((await archiveInvalidKeys(actor)).archived, 1);
  const view = await listPool(actor);
  assert.equal(view.archived.length, 1);
  assert.equal(view.keys.length, 1);
  await poolKeyState(actor, view.archived[0].id, "active");
  assert.equal(
    (await listPool(actor)).keys.find((k) => k.id === view.archived[0].id)
      .status,
    "disabled",
  );
  await assert.rejects(
    () => poolKeyState(actor, view.archived[0].id, "active"),
    { code: "KEY_RETEST_REQUIRED" },
  );
  await testPoolKeys(actor, view.archived[0].id, async () =>
    json({ models: [] }),
  );
  await poolKeyState(actor, view.archived[0].id, "active");
});
test("free tier forces cache off and policy snapshot preserves routing while hidden TTS/timezone settings survive", async () => {
  await pg.query(
    "UPDATE integration_settings SET config=config||$2::jsonb WHERE tenant_id=$1 AND kind='gemini'",
    ["a", { ttsModel: "internal-audio", budgetTimezone: "Asia/Jakarta" }],
  );
  const c = await savePoolSettings(actor, {
    tier: "free",
    model: "gemini-3.6-flash",
    fallbackModel: "custom-fallback",
    contextCaching: true,
    smartRouting: true,
  });
  assert.equal(c.contextCaching, false);
  assert.equal(c.ttsModel, "internal-audio");
  assert.equal(c.budgetTimezone, "Asia/Jakarta");
  const snapshot = await productionDefaults(getPool(), "a");
  await savePoolSettings(actor, {
    tier: "paid",
    model: "new-model",
    smartRouting: false,
  });
  assert.equal(snapshot.geminiConfig.model, "gemini-3.6-flash");
  assert.equal(snapshot.geminiConfig.tier, "free");
  await assert.rejects(
    () => savePoolSettings(actor, { tier: "paid", model: "bad/model" }),
    { code: "MODEL_INVALID" },
  );
});
const generated = () =>
  json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
test("paid module routing selects extraction/deconstruct/campaign models through the same pool", async () => {
  await resetPool();
  await add("ignored", 30, ["TEST_MOCK_ROUTING"]);
  await savePoolSettings(actor, {
    tier: "paid",
    model: "custom-primary",
    smartRouting: true,
    contextCaching: false,
  });
  const urls = [],
    g = new ProviderGateway({
      fetcher: async (u) => {
        urls.push(String(u));
        return generated();
      },
    }),
    connection = await resolveConnection("a", null, "gemini");
  for (const module of ["extraction", "deconstruct", "campaign"])
    await g.gemini(connection, "test", { module });
  assert.ok(urls[0].includes("gemini-1.5-flash-8b"));
  assert.ok(urls[1].includes("gemini-2.5-flash"));
  assert.ok(urls[2].includes("gemini-3.6-flash"));
});
test("safe model rejection falls back in order but ambiguous generation never changes model or key", async () => {
  await resetPool();
  await add("ignored", 30, ["TEST_MOCK_FALLBACK"]);
  await savePoolSettings(actor, {
    tier: "free",
    model: "custom-primary",
    fallbackModel: "custom-backup",
    smartRouting: false,
  });
  const urls = [];
  const g = new ProviderGateway({
    fetcher: async (u) => {
      urls.push(String(u));
      return urls.length === 1
        ? json({ error: { status: "NOT_FOUND" } }, 404)
        : generated();
    },
  });
  await g.gemini(await resolveConnection("a", null, "gemini"), "test");
  assert.equal(urls.length, 2);
  assert.ok(urls[0].includes("custom-primary"));
  assert.ok(urls[1].includes("custom-backup"));
  let calls = 0;
  const awaitedConnection = await resolveConnection("a", null, "gemini");
  const lost = new ProviderGateway({
    fetcher: async () => {
      calls++;
      throw new Error("lost");
    },
  });
  await assert.rejects(() => lost.gemini(awaitedConnection, "test"), {
    code: "PROVIDER_OUTCOME_UNKNOWN",
  });
  assert.equal(calls, 1);
});
test("context cache reuses exact long prompt scoped to credential/model and remains disabled for free tier", async () => {
  await resetPool();
  await add("ignored", 30, ["TEST_MOCK_CACHE"]);
  await savePoolSettings(actor, {
    tier: "paid",
    model: "cache-model",
    contextCaching: true,
    smartRouting: false,
  });
  let caches = 0,
    generations = 0;
  const g = new ProviderGateway({
    fetcher: async (u, o) => {
      const body = JSON.parse(o.body);
      if (String(u).includes("cachedContents")) {
        caches++;
        assert.equal(body.model, "models/cache-model");
        return json({
          name: "cachedContents/test_cache",
          expireTime: new Date(Date.now() + 900000).toISOString(),
        });
      }
      generations++;
      assert.equal(body.cachedContent, "cachedContents/test_cache");
      return generated();
    },
  });
  const c = await resolveConnection("a", null, "gemini"),
    prompt = "Long input ".repeat(1000);
  await g.gemini(c, prompt);
  await g.gemini(c, prompt);
  assert.equal(caches, 1);
  assert.equal(generations, 2);
  await savePoolSettings(actor, {
    tier: "free",
    model: "cache-model",
    contextCaching: true,
  });
  const uncached = new ProviderGateway({
    fetcher: async (u, o) => {
      assert.ok(!String(u).includes("cachedContents"));
      assert.equal(JSON.parse(o.body).cachedContent, undefined);
      return generated();
    },
  });
  await uncached.gemini(await resolveConnection("a", null, "gemini"), prompt);
});
test("cache rejection falls back inline and cached-resource rejection retries inline only after explicit rejection", async () => {
  await resetPool();
  await add("ignored", 30, ["TEST_MOCK_CACHE_REJECT"]);
  await savePoolSettings(actor, {
    tier: "paid",
    model: "cache-model",
    contextCaching: true,
  });
  let cacheCalls = 0,
    posts = 0;
  const g = new ProviderGateway({
    fetcher: async (u, o) => {
      if (String(u).includes("cachedContents")) {
        cacheCalls++;
        return json({ error: { status: "INVALID_ARGUMENT" } }, 400);
      }
      posts++;
      assert.equal(JSON.parse(o.body).cachedContent, undefined);
      return generated();
    },
  });
  await g.gemini(
    await resolveConnection("a", null, "gemini"),
    "Prompt ".repeat(1500),
  );
  assert.equal(cacheCalls, 1);
  assert.equal(posts, 1);
  await pg.exec("DELETE FROM gemini_context_caches");
  let attempts = 0;
  const expired = new ProviderGateway({
    fetcher: async (u, o) => {
      if (String(u).includes("cachedContents"))
        return json({
          name: "cachedContents/expired",
          expireTime: new Date(Date.now() + 900000).toISOString(),
        });
      attempts++;
      return JSON.parse(o.body).cachedContent
        ? json({ error: { status: "NOT_FOUND" } }, 404)
        : generated();
    },
  });
  await expired.gemini(
    await resolveConnection("a", null, "gemini"),
    "Prompt ".repeat(1500),
  );
  assert.equal(attempts, 2);
});

test("structured 503 safely falls back, while an unstructured server error remains unknown", async () => {
  await resetPool();
  await add("unused", 20, ["TEST_MOCK_BUSY"]);
  await savePoolSettings(actor, {
    tier: "free",
    model: "busy-primary",
    fallbackModel: "busy-backup",
  });
  let calls = 0;
  const g = new ProviderGateway({
    fetcher: async () =>
      ++calls === 1
        ? json({ error: { status: "UNAVAILABLE" } }, 503)
        : generated(),
  });
  await g.gemini(await resolveConnection("a", null, "gemini"), "test");
  assert.equal(calls, 2);
  let unknown = 0;
  const c = await resolveConnection("a", null, "gemini"),
    g2 = new ProviderGateway({
      fetcher: async () => {
        unknown++;
        return json({}, 503);
      },
    });
  await assert.rejects(() => g2.gemini(c, "test"), {
    code: "PROVIDER_OUTCOME_UNKNOWN",
  });
  assert.equal(unknown, 1);
});
test("context caches never cross tenant or model boundaries for identical prompts", async () => {
  await resetPool();
  await add("unused", 20, ["TEST_MOCK_SCOPE_A"]);
  await addPoolKeys(
    other,
    {
      validateLive: true,
      keys: [{ name: "B", apiKey: "TEST_MOCK_SCOPE_B", dailyLimit: 20 }],
    },
    async () => json({ models: [] }),
  );
  for (const a of [actor, other])
    await savePoolSettings(a, {
      tier: "paid",
      model: "scoped-model",
      contextCaching: true,
    });
  let caches = 0;
  const g = new ProviderGateway({
      fetcher: async (u, o) =>
        String(u).includes("cachedContents")
          ? json({
              name: "cachedContents/scope_" + ++caches,
              expireTime: new Date(Date.now() + 900000).toISOString(),
            })
          : generated(),
    }),
    prompt = "Scoped long prompt ".repeat(600);
  await g.gemini(await resolveConnection("a", null, "gemini"), prompt);
  await g.gemini(await resolveConnection("b", null, "gemini"), prompt);
  assert.equal(caches, 2);
  await savePoolSettings(actor, {
    tier: "paid",
    model: "other-model",
    contextCaching: true,
  });
  await g.gemini(await resolveConnection("a", null, "gemini"), prompt);
  assert.equal(caches, 3);
  assert.equal(
    (
      await pg.query(
        "SELECT count(DISTINCT tenant_id)::int n FROM gemini_context_caches",
      )
    ).rows[0].n,
    2,
  );
});
