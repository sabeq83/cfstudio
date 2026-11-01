import { fakeGoogle, installFakeDrive } from "./helpers/fake-google.mjs";
import { setGoogleTestFetch } from "../lib/google-drive.js";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, writeFile, mkdtemp, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { setTestDatabase, getPool, transaction } from "../lib/db-pg.js";
import { gateway, pcmToWav, ProviderGateway } from "../lib/provider-gateway.js";
import { saveCatalog, assignExisting } from "../lib/catalog-service.js";
import { saveConnection } from "../lib/connections.js";
import {
  saveRoutine,
  activateRoutine,
  runOnce,
} from "../lib/automation-service.js";
import { processProduction, scheduleDue } from "../lib/production-worker.js";
import { saveArtifact, loadArtifact } from "../lib/artifact-store.js";
import {
  mediaCommand,
  duration,
  smartSync,
  muxPackage,
} from "../lib/media-services.js";
import {
  approveFinal,
  editContent,
  approveCreative,
  regenerateItem,
} from "../lib/review-service.js";
import {
  createPublishingIntent,
  processPublishing,
  providerState,
  cancelIntent,
} from "../lib/publishing-service.js";
import { providerJob } from "../lib/provider-jobs.js";
import {
  inQuietHours,
  queueNotification,
  deliverNotification,
  startTelegramVerification,
  finishTelegramVerification,
} from "../lib/notification-service.js";
let pg,
  dir,
  brand,
  preset,
  product,
  source,
  run,
  video,
  png,
  google,
  geminiConnection,
  replizPosts = 0,
  taskIndex = 0;
const tasks = new Map();
const actor = {
  id: "actor",
  tenantId: "tenant",
  status: "active",
  tenantStatus: "active",
  allBrands: true,
  brandIds: [],
  capabilities: [
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
  ],
};
const recipe = {
  title: "Resep uji",
  ingredients: [{ name: "Tepung", amount: 100, unit: "g" }],
  steps: [{ index: 1, instruction: "Campurkan tepung." }],
  prep_minutes: 5,
  cook_minutes: 5,
};
const json = (v) =>
  new Response(JSON.stringify(v), {
    headers: { "Content-Type": "application/json" },
  });
before(async () => {
  process.env.NODE_ENV = "test";
  process.env.ENABLE_PRODUCTION_DISPATCH = "true";
  process.env.ENABLE_PUBLISHING_DISPATCH = "true";
  process.env.CF_MASTER_KEY_B64 = randomBytes(32).toString("base64");
  process.env.CF_MEDIA_SIGNING_KEY = "TEST_MOCK_SIGNING_KEY";
  process.env.CF_PUBLIC_BASE_URL = "https://studio.example.test";
  dir = await mkdtemp(path.join(os.tmpdir(), "cf-e2e-"));
  process.env.CF_STORAGE_ROOT = path.join(dir, "storage");
  pg = new PGlite();
  for (const name of (
    await readdir(new URL("../db/migrations", import.meta.url))
  ).sort())
    await pg.exec(
      await readFile(
        new URL("../db/migrations/" + name, import.meta.url),
        "utf8",
      ),
    );
  const query = async (sql, args) => {
    const r = await pg.query(sql, args);
    return { ...r, rowCount: r.rows.length || r.affectedRows || 0 };
  };
  setTestDatabase({ query, connect: async () => ({ query, release() {} }) });
  await pg.query("INSERT INTO tenants(id,name) VALUES($1,$2)", [
    actor.tenantId,
    "Test",
  ]);
  await pg.query(
    "INSERT INTO users(id,tenant_id,username,password_hash,capabilities,brand_ids,all_brands) VALUES($1,$2,$3,$4,$5,$6,true)",
    [
      actor.id,
      actor.tenantId,
      "test",
      "TEST_MOCK_HASH",
      JSON.stringify(actor.capabilities),
      "[]",
    ],
  );
  await mediaCommand([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=160x284:d=0.3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    path.join(dir, "fixture.mp4"),
  ]);
  await mediaCommand([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=160x284",
    "-frames:v",
    "1",
    path.join(dir, "fixture.png"),
  ]);
  video = await readFile(path.join(dir, "fixture.mp4"));
  png = await readFile(path.join(dir, "fixture.png"));
  gateway.fetch = async (url, options = {}) => {
    const u = new URL(url);
    if (u.pathname.includes(":generateContent")) {
      const body = JSON.parse(options.body);
      if (body.generationConfig.responseModalities)
        return json({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "audio/wav",
                      data: pcmToWav(Buffer.alloc(24000)).toString("base64"),
                    },
                  },
                ],
              },
            },
          ],
        });
      const prompt = body.contents[0].parts[0].text;
      const v = prompt.startsWith("Extract only verifiable product facts")
        ? {
            product_name: "Verified test product",
            product_description: "Facts from supplied description",
            product_truth: { material: "flour" },
          }
        : prompt.startsWith("Analyze this video")
          ? {
              title: "Analyzed test video",
              scenes: [
                {
                  id: "scene1",
                  visual_description: "Observed fixture",
                  voice_over: "",
                  start_time: 0,
                  end_time: 0.3,
                },
              ],
            }
          : prompt.includes("MAKNA content planner")
            ? {
                title: "Uji plan",
                hook: "Hook uji",
                cep: "Saat membutuhkan camilan",
                recipe,
                outline: ["A"],
              }
            : {
                title: "Uji hasil",
                caption: "Caption uji",
                recipe,
                videoDna: {
                  pilar_konten: "test",
                  hook_type: "test",
                  visual_style: "test",
                  signature_moment: "test",
                  camera_pace: "test",
                  primary_emotion: "test",
                  affiliate_integration: "none",
                  affiliate_mention: "none",
                  scene_count: 1,
                  cta_type: "test",
                },
                socialPackage: {
                  title: "Hasil",
                  caption: "Caption uji",
                  hashtags: ["uji"],
                  cta: "Lihat resep",
                },
                scenes: [
                  {
                    id: "scene-1",
                    mode: "i2v",
                    duration: 0.3,
                    imagePrompt: "A bowl of flour",
                    videoPrompt: "Stir flour slowly",
                    narration: "Campur tepung.",
                    referenceCritical: prompt.includes(
                      "Source kind: product_campaign",
                    ),
                  },
                ],
              };
      return json({
        candidates: [{ content: { parts: [{ text: JSON.stringify(v) }] } }],
      });
    }
    if (
      u.pathname.endsWith("/api/image/generate") ||
      u.pathname.endsWith("/api/video/generate")
    ) {
      const id = "task-" + ++taskIndex;
      tasks.set(id, u.pathname.includes("/video/"));
      return json({ task_id: id });
    }
    if (u.pathname.includes("/api/status/"))
      return json({ status: "succeeded" });
    if (u.pathname.includes("/api/result/"))
      return json({
        results: [
          tasks.get(u.pathname.split("/").pop())
            ? "fixture.mp4"
            : "fixture.png",
        ],
      });
    if (u.pathname.endsWith("/fixture.mp4"))
      return new Response(video, { headers: { "Content-Type": "video/mp4" } });
    if (u.pathname.endsWith("/fixture.png"))
      return new Response(png, { headers: { "Content-Type": "image/png" } });
    if (u.pathname.startsWith("/public/account/"))
      return json({ id: "provider-account", isConnected: true });
    if (
      u.pathname.startsWith("/public/schedule/") &&
      options.method === "DELETE"
    )
      return new Response(null, { status: 204 });
    if (u.pathname === "/public/schedule" && options.method === "POST") {
      replizPosts++;
      return json({ id: "schedule-test", status: "scheduled" });
    }
    throw new Error("UNEXPECTED_TEST_ENDPOINT");
  };
  google = fakeGoogle();
  setGoogleTestFetch(google.fetcher);
  await installFakeDrive(actor, google);
  brand = await saveCatalog(actor, {
    domain: "brand",
    name: "Test brand",
    payload: {},
  });
  preset = await saveCatalog(actor, {
    domain: "preset",
    name: "Test preset",
    payload: {
      config_json: {
        workflow: {
          voice_provider: "gemini",
          enable_tts: true,
          ffmpeg_sync_option: "smart_sync",
          ffmpeg_video_scale: 1,
          voice_volume: 1,
        },
        visual_engine: {
          target_clips_count: 1,
          clip_duration: 0.3,
          aspect_ratio: "9:16",
        },
      },
    },
  });
  await assignExisting(actor, brand.id, { objectId: preset.id });
  product = await saveCatalog(actor, {
    domain: "product",
    brandId: brand.id,
    name: "Test product",
    payload: { photo_status: "approved" },
  });
  const a = await saveArtifact({
    tenantId: actor.tenantId,
    brandId: brand.id,
    objectId: product.id,
    revision: 1,
    kind: "product_photo",
    buffer: png,
    mimeType: "image/png",
    extension: "png",
  });
  product = await saveCatalog(actor, {
    id: product.id,
    expectedRevision: 1,
    domain: "product",
    brandId: brand.id,
    name: product.name,
    payload: {
      photo_status: "approved",
      photoArtifactId: { assetId: a.id, sha256: a.sha256 },
    },
  });
  source = await saveCatalog(actor, {
    domain: "deconstruct",
    brandId: brand.id,
    name: "Test source",
    payload: {
      status: "deconstructed",
      original_storyboard_json: [{ text: "source" }],
    },
  });
  geminiConnection = await saveConnection(actor, {
    kind: "gemini",
    label: "Fake Gemini",
    config: {
      baseUrl: "https://provider.example.test/",
      delayEnabled: false,
      maxConcurrent: 10,
      model: "test-model",
    },
    secret: { apiKey: "TEST_MOCK_API_KEY" },
  });
  await saveConnection(actor, {
    kind: "glabs",
    label: "Fake G-Labs",
    config: {
      baseUrl: "https://provider.example.test/",
      delayEnabled: false,
      maxConcurrent: 10,
    },
    secret: { apiKey: "TEST_MOCK_API_KEY" },
  });
});
after(async () => {
  setTestDatabase(null);
  await pg.close();
  await rm(dir, { recursive: true, force: true });
});
test("five source lanes render through one durable pipeline with actual FFmpeg", async () => {
  const targets = [
    "multiplier",
    "recipe_video",
    "recipe_static",
    "brand_editorial",
    "product_campaign",
  ].map((kind) => ({
    kind,
    name: kind,
    count: 1,
    presetId: preset.id,
    ...(kind === "multiplier" ? { sourceId: source.id } : {}),
    ...(kind === "product_campaign" ? { productId: product.id } : {}),
  }));
  const r = await saveRoutine(actor, {
    name: "All lanes",
    brandId: brand.id,
    timezone: "Asia/Jakarta",
    time: "05:00",
    frequency: "daily",
    creativeApproval: "auto",
    targets,
  });
  run = await runOnce(
    actor,
    r.id,
    { source: "draft", expectedRevision: r.revision },
    "run-five",
  );
  for (let i = 0; i < 8; i++) {
    await getPool().query(
      "UPDATE automation_runs SET next_attempt_at=NULL WHERE id=$1",
      [run.id],
    );
    await processProduction("test-worker");
    const state = (
      await pg.query("SELECT status FROM automation_runs WHERE id=$1", [run.id])
    ).rows[0].status;
    if (state === "completed") break;
  }
  const items = (
    await pg.query(
      "SELECT * FROM content_items WHERE run_id=$1 ORDER BY source_kind",
      [run.id],
    )
  ).rows;
  assert.equal(items.length, 5);
  assert.deepEqual(
    items.map((i) => i.status),
    ["ready", "ready", "ready", "ready", "ready"],
  );
  for (const item of items) {
    const { asset, buffer } = await loadArtifact(
      actor.tenantId,
      item.artifacts.final.id,
    );
    assert.ok(buffer.length > 0);
    assert.equal(
      asset.kind,
      item.source_kind === "recipe_static" ? "static_final" : "video_final",
    );
    assert.ok(item.creative_decision?.presetId);
  }
  const stat = items.find((i) => i.source_kind === "recipe_static");
  const forbidden = (
    await pg.query(
      `SELECT stage FROM stage_executions WHERE item_id=$1 AND stage IN('tts','clips','ffmpeg')`,
      [stat.id],
    )
  ).rows;
  assert.equal(forbidden.length, 0);
  const count = (await pg.query("SELECT count(*)::int AS n FROM provider_jobs"))
    .rows[0].n;
  await processProduction("another-worker");
  assert.equal(
    (await pg.query("SELECT count(*)::int AS n FROM provider_jobs")).rows[0].n,
    count,
  );
});
test("provider unknown outcome is durable and never dispatches second POST", async () => {
  const item = (await pg.query("SELECT * FROM content_items LIMIT 1")).rows[0];
  const conn = { ...geminiConnection, secret: {} };
  let calls = 0;
  const pkg = {
    tenantId: actor.tenantId,
    itemId: item.id,
    revision: item.revision,
  };
  const invoke = () =>
    providerJob(pkg, conn, "uncertain", "test_unknown", { n: 1 }, async () => {
      calls++;
      const e = new Error("ambiguous");
      e.code = "PROVIDER_OUTCOME_UNKNOWN";
      throw e;
    });
  await assert.rejects(invoke, { code: "PROVIDER_OUTCOME_UNKNOWN" });
  await assert.rejects(invoke, { code: "PROVIDER_OUTCOME_UNKNOWN" });
  assert.equal(calls, 1);
});
test("final approval required, exact snapshot scheduled once, accepted is not published", async () => {
  const item = (
    await pg.query(
      `SELECT * FROM content_items WHERE source_kind='brand_editorial'`,
    )
  ).rows[0];
  const connection = await saveConnection(actor, {
    kind: "repliz",
    label: "Fake Repliz",
    config: {
      baseUrl: "https://provider.example.test/",
      delayEnabled: false,
      maxConcurrent: 10,
    },
    secret: { accessKey: "TEST_MOCK_ACCESS", secretKey: "TEST_MOCK_SECRET" },
  });
  await pg.query(
    `INSERT INTO integration_accounts(id,tenant_id,brand_id,connection_id,provider_account_id,label,platform,capabilities) VALUES('account',$1,$2,$3,'provider-account','Test account','instagram',$4)`,
    [
      actor.tenantId,
      brand.id,
      connection.id,
      JSON.stringify({ video: true, image: true }),
    ],
  );
  const input = {
    revision: item.revision,
    accountId: "account",
    scheduledAt: new Date(Date.now() + 600000).toISOString(),
  };
  await assert.rejects(
    () => createPublishingIntent(actor, item.id, input, "before-approval"),
    { code: "FINAL_APPROVAL_REQUIRED" },
  );
  await approveFinal(actor, item.id, item.revision);
  const a = await createPublishingIntent(
      actor,
      item.id,
      input,
      "schedule-once",
    ),
    b = await createPublishingIntent(actor, item.id, input, "schedule-once");
  assert.equal(a.id, b.id);
  await processPublishing("publisher");
  await processPublishing("publisher2");
  const state = (
    await pg.query("SELECT * FROM publishing_intents WHERE id=$1", [a.id])
  ).rows[0];
  assert.equal(state.status, "accepted");
  assert.equal(replizPosts, 1);
  await assert.rejects(
    () =>
      editContent(actor, item.id, {
        expectedRevision: item.revision,
        caption: "Edit after scheduling",
      }),
    { code: "PUBLISHING_ACTIVE" },
  );
});
test("scheduler uses active snapshot and deduplicates same slot", async () => {
  const r = await saveRoutine(actor, {
    name: "Scheduled",
    brandId: brand.id,
    timezone: "Asia/Jakarta",
    time: "05:00",
    frequency: "daily",
    creativeApproval: "auto",
    targets: [
      { name: "Static", kind: "recipe_static", count: 1, presetId: preset.id },
    ],
  });
  await activateRoutine(actor, r.id, 1);
  const now = new Date();
  await pg.query("UPDATE routines SET next_run_at=$2 WHERE id=$1", [r.id, now]);
  assert.equal(await scheduleDue(now), 1);
  assert.equal(await scheduleDue(now), 0);
  assert.equal(
    (
      await pg.query(
        "SELECT count(*)::int AS n FROM automation_runs WHERE routine_id=$1 AND execution_mode='scheduled'",
        [r.id],
      )
    ).rows[0].n,
    1,
  );
});
test("notifications scoped and quiet hours cross midnight; provider status not conflated", async () => {
  assert.equal(
    inQuietHours(
      { quiet_start: "22:00", quiet_end: "07:00", timezone: "Asia/Jakarta" },
      new Date("2026-11-01T16:00:00Z"),
    ),
    true,
  );
  assert.equal(
    inQuietHours(
      { quiet_start: "22:00", quiet_end: "07:00", timezone: "Asia/Jakarta" },
      new Date("2026-11-01T05:00:00Z"),
    ),
    false,
  );
  assert.equal(
    providerState({ status: "scheduled", id: "s" }).status,
    "accepted",
  );
  assert.equal(
    providerState({ status: "published", id: "s", postId: "post-s" }).status,
    "published",
  );
  assert.equal(smartSync(8, 10, 1).freezeSeconds, 2);
  assert.equal(smartSync(8, 6, 1).freezeSeconds, 0);
  await transaction((db) =>
    queueNotification(db, {
      tenantId: actor.tenantId,
      brandId: brand.id,
      eventKey: "n",
      eventType: "error",
      message: "test",
    }),
  );
  assert.equal(
    (await pg.query("SELECT count(*)::int AS n FROM notification_outbox"))
      .rows[0].n,
    0,
  );
});
test("dispatch disabled blocks provider before HTTP call", async () => {
  const old = process.env.ENABLE_PRODUCTION_DISPATCH;
  process.env.ENABLE_PRODUCTION_DISPATCH = "false";
  let calls = 0;
  const g = new ProviderGateway({
    fetcher: async () => {
      calls++;
      return json({});
    },
  });
  await assert.rejects(
    () =>
      g.json(
        {
          config: { baseUrl: "https://provider.example.test" },
          secret: {},
          kind: "glabs",
        },
        "POST",
        "api/image/generate",
        {},
      ),
    { code: "DISPATCH_DISABLED" },
  );
  assert.equal(calls, 0);
  process.env.ENABLE_PRODUCTION_DISPATCH = old;
});

test("manual creative review pauses before TTS and resumes existing frames", async () => {
  const r = await saveRoutine(actor, {
    name: "Manual review",
    brandId: brand.id,
    timezone: "Asia/Jakarta",
    time: "05:00",
    frequency: "daily",
    creativeApproval: "manual",
    targets: [
      {
        name: "Editorial",
        kind: "brand_editorial",
        count: 1,
        presetId: preset.id,
      },
    ],
  });
  const run = await runOnce(
    actor,
    r.id,
    { source: "draft", expectedRevision: r.revision },
    "manual-run",
  );
  let item;
  for (let i = 0; i < 5; i++) {
    await pg.query(
      "UPDATE automation_runs SET next_attempt_at=NULL WHERE id=$1",
      [run.id],
    );
    await processProduction("manual-worker");
    item = (
      await pg.query("SELECT * FROM content_items WHERE run_id=$1", [run.id])
    ).rows[0];
    if (item.status === "awaiting_creative_approval") break;
  }
  assert.equal(item.status, "awaiting_creative_approval");
  assert.equal(
    (
      await pg.query(
        "SELECT count(*)::int AS n FROM provider_jobs WHERE item_id=$1 AND stage LIKE 'tts%'",
        [item.id],
      )
    ).rows[0].n,
    0,
  );
  await approveCreative(actor, item.id, item.revision);
  for (let i = 0; i < 5; i++) {
    await pg.query(
      "UPDATE automation_runs SET next_attempt_at=NULL WHERE id=$1",
      [run.id],
    );
    await processProduction("manual-worker");
    item = (
      await pg.query("SELECT * FROM content_items WHERE run_id=$1", [run.id])
    ).rows[0];
    if (item.status === "ready") break;
  }
  assert.equal(item.status, "ready");
  assert.equal(item.creative_decision.type, "human");
  assert.equal(
    (
      await pg.query(
        "SELECT count(*)::int AS n FROM provider_jobs WHERE item_id=$1 AND stage='start_frames'",
        [item.id],
      )
    ).rows[0].n,
    1,
  );
});
test("snapshot cannot be forged; active revision stays frozen after preset edit", async () => {
  const input = {
    name: "Immutable active",
    brandId: brand.id,
    timezone: "Asia/Jakarta",
    time: "05:00",
    frequency: "daily",
    creativeApproval: "auto",
    targets: [
      {
        name: "Editorial",
        kind: "brand_editorial",
        count: 1,
        presetSnapshot: { id: "forged" },
      },
    ],
  };
  const forged = await saveRoutine(actor, input);
  await assert.rejects(() => activateRoutine(actor, forged.id, 1), {
    code: "PRESET_REQUIRED",
  });
  const valid = await saveRoutine(actor, {
    ...input,
    targets: [
      {
        name: "Editorial",
        kind: "brand_editorial",
        count: 1,
        presetId: preset.id,
      },
    ],
  });
  await activateRoutine(actor, valid.id, 1);
  await saveCatalog(actor, {
    id: preset.id,
    expectedRevision: preset.revision,
    domain: "preset",
    name: preset.name,
    payload: { config_json: { workflow: { voice_speed: 1.2 } } },
  });
  const once = await runOnce(
    actor,
    valid.id,
    { source: "active", expectedRevision: 1 },
    "frozen-run",
  );
  assert.equal(once.config.targets[0].presetSnapshot.revision, 1);
  assert.equal(
    once.config.targets[0].presetSnapshot.payload.config_json.workflow
      .ffmpeg_video_scale,
    1,
  );
});
test("provider cancellation is queued and executes only once", async () => {
  const intent = (
    await pg.query(
      "SELECT * FROM publishing_intents WHERE provider_id='schedule-test'",
    )
  ).rows[0];
  const requested = await cancelIntent(actor, intent.id);
  assert.equal(requested.cancelRequested, true);
  await processPublishing("cancel-worker");
  const canceled = (
    await pg.query(
      "SELECT status,provider_id FROM publishing_intents WHERE id=$1",
      [intent.id],
    )
  ).rows[0];
  assert.equal(canceled.status, "canceled");
  assert.equal(canceled.provider_id, "schedule-test");
});
test("Telegram recipient verification, deduplication, delivery and crash uncertainty", async () => {
  process.env.ENABLE_TELEGRAM_DISPATCH = "true";
  const original = globalThis.fetch;
  let code = "",
    sends = 0;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (String(url).endsWith("/getUpdates"))
      return json({
        ok: true,
        result: [
          { message: { chat: { type: "private", id: 123 }, text: code } },
        ],
      });
    if (String(url).endsWith("/sendMessage")) {
      sends++;
      assert.equal(body.chat_id, "123");
      return json({ ok: true, result: { message_id: 1 } });
    }
    throw new Error("UNEXPECTED_TELEGRAM");
  };
  try {
    const c = await saveConnection(actor, {
      kind: "telegram",
      label: "Test bot",
      config: {},
      secret: { botToken: "TEST_MOCK_BOT_TOKEN" },
    });
    const challenge = await startTelegramVerification(actor, {
      connectionId: c.id,
    });
    code = challenge.message;
    await finishTelegramVerification(actor, {});
    await transaction(async (db) => {
      for (let n = 0; n < 2; n++)
        await queueNotification(db, {
          tenantId: actor.tenantId,
          brandId: brand.id,
          eventKey: "dedup",
          eventType: "error",
          message: "Pipeline test",
        });
    });
    assert.equal(
      (await pg.query("SELECT count(*)::int AS n FROM notification_outbox"))
        .rows[0].n,
      1,
    );
    await deliverNotification("notifier");
    await deliverNotification("notifier");
    assert.equal(sends, 1);
    await pg.exec(
      "INSERT INTO notification_outbox(id,tenant_id,event_key,payload,status,recipient_id,lease_expires_at) VALUES('crash','tenant','crash','{}','sending','actor',now()-interval '1 minute')",
    );
    await deliverNotification("notifier");
    assert.equal(
      (
        await pg.query(
          "SELECT status FROM notification_outbox WHERE id='crash'",
        )
      ).rows[0].status,
      "unknown",
    );
    assert.equal(sends, 1);
  } finally {
    globalThis.fetch = original;
    process.env.ENABLE_TELEGRAM_DISPATCH = "false";
  }
});

import { claimRun, completeRun } from "../lib/automation-repository.js";

test("native video without audio renders a valid silent track and selected aspect ratio", async () => {
  const item = (await pg.query("SELECT * FROM content_items LIMIT 1")).rows[0];
  const clip = await saveArtifact({
    tenantId: actor.tenantId,
    brandId: brand.id,
    objectId: item.id,
    revision: 1,
    kind: "native_clip",
    buffer: video,
    mimeType: "video/mp4",
    extension: "mp4",
  });
  const output = await muxPackage(
    {
      tenantId: actor.tenantId,
      brandId: brand.id,
      itemId: item.id,
      revision: 1,
      scenes: [{ id: "native" }],
      audioMode: "native",
      visual: { aspectRatio: "16:9" },
      mux: {
        syncOption: "smart_sync",
        videoScale: 1,
        bgmVolume: 0,
        sfxVolume: 0,
      },
    },
    { clips: { native: clip } },
  );
  const { buffer } = await loadArtifact(actor.tenantId, output.id);
  const file = path.join(dir, "native-out.mp4");
  await writeFile(file, buffer);
  assert.ok((await duration(file)) > 0);
});
test("expired worker cannot complete a reclaimed run", async () => {
  await pg.exec(
    "UPDATE automation_runs SET status='failed' WHERE status IN('queued','processing')",
  );
  const r = await saveRoutine(actor, {
    name: "Lease",
    brandId: brand.id,
    timezone: "Asia/Jakarta",
    time: "05:00",
    frequency: "daily",
    creativeApproval: "manual",
    targets: [{ name: "Static", kind: "recipe_static", count: 1 }],
  });
  const run = await runOnce(
    actor,
    r.id,
    { source: "draft", expectedRevision: 1 },
    "lease-run",
  );
  const old = await claimRun("worker-old");
  assert.equal(old.id, run.id);
  await pg.query(
    "UPDATE automation_runs SET lease_expires_at=now()-interval '1 minute' WHERE id=$1",
    [run.id],
  );
  const fresh = await claimRun("worker-fresh");
  assert.ok(Number(fresh.fencing_token) > Number(old.fencing_token));
  await assert.rejects(() => completeRun(getPool(), old, {}), {
    code: "STALE_LEASE",
  });
  await completeRun(getPool(), fresh, {});
});
test("explicit rate-limit rejection can retry without losing request hash", async () => {
  const item = (await pg.query("SELECT * FROM content_items LIMIT 1")).rows[0];
  const pkg = {
    tenantId: actor.tenantId,
    itemId: item.id,
    revision: item.revision,
  };
  let n = 0;
  const invoke = () =>
    providerJob(
      pkg,
      geminiConnection,
      "rate",
      "rate_test",
      { prompt: "constant" },
      async () => {
        if (++n === 1) {
          const e = new Error("rate");
          e.code = "PROVIDER_RATE_LIMIT";
          throw e;
        }
        return { done: true };
      },
    );
  await assert.rejects(invoke, { code: "PROVIDER_RATE_LIMIT" });
  assert.deepEqual(await invoke(), { done: true });
  assert.equal(n, 2);
  await assert.rejects(
    () =>
      providerJob(
        pkg,
        geminiConnection,
        "rate",
        "rate_test",
        { prompt: "changed" },
        async () => ({}),
      ),
    { code: "JOB_INPUT_CHANGED" },
  );
});

import {
  uploadCatalogFile,
  approveProductPhoto,
  queueCatalogAnalysis,
  processCatalogAnalysis,
} from "../lib/lab-service.js";

test("product upload needs photo review and analysis uses frozen catalog revision", async () => {
  let product = await saveCatalog(actor, {
    domain: "product",
    brandId: brand.id,
    name: "Upload product",
    payload: { raw_description: "Tepung terigu untuk membuat makanan." },
  });
  product = await uploadCatalogFile(
    actor,
    { objectId: product.id, expectedRevision: 1 },
    new File([png], "photo.png", { type: "image/png" }),
  );
  assert.equal(product.payload.photo_status, "needs_review");
  product = await approveProductPhoto(actor, product.id, product.revision);
  assert.equal(product.payload.photo_status, "approved");
  const a = await queueCatalogAnalysis(actor, product.id, product.revision),
    b = await queueCatalogAnalysis(actor, product.id, product.revision);
  assert.equal(a.id, b.id);
  await processCatalogAnalysis("lab-worker");
  const result = (
    await pg.query("SELECT * FROM catalog_items WHERE id=$1", [product.id])
  ).rows[0];
  assert.equal(result.name, "Verified test product");
  assert.equal(result.payload.extraction_status, "completed");
  assert.equal(
    result.payload.photoArtifactId.sha256,
    product.payload.photoArtifactId.sha256,
  );
});
test("deconstruct requires real uploaded video; analyzed storyboard becomes usable", async () => {
  let object = await saveCatalog(actor, {
    domain: "deconstruct",
    brandId: brand.id,
    name: "New video",
    payload: {},
  });
  await assert.rejects(() => queueCatalogAnalysis(actor, object.id, 1), {
    code: "VIDEO_REQUIRED",
  });
  await assert.rejects(
    () =>
      uploadCatalogFile(
        actor,
        { objectId: object.id, expectedRevision: 1 },
        new File([png], "wrong.mp4"),
      ),
    { code: "FILE_TYPE_INVALID" },
  );
  object = await uploadCatalogFile(
    actor,
    { objectId: object.id, expectedRevision: 1 },
    new File([video], "source.mp4", { type: "video/mp4" }),
  );
  await queueCatalogAnalysis(actor, object.id, object.revision);
  await processCatalogAnalysis("lab-worker");
  const result = (
    await pg.query("SELECT * FROM catalog_items WHERE id=$1", [object.id])
  ).rows[0];
  assert.equal(result.payload.status, "deconstructed");
  assert.equal(result.payload.original_storyboard_json.length, 1);
});
test("analysis result does not overwrite catalog edit and scoped user cannot upload across brand", async () => {
  let object = await saveCatalog(actor, {
    domain: "product",
    brandId: brand.id,
    name: "Conflict product",
    payload: { raw_description: "Sumber produk yang valid untuk ekstraksi." },
  });
  await queueCatalogAnalysis(actor, object.id, object.revision);
  object = await saveCatalog(actor, {
    id: object.id,
    expectedRevision: 1,
    domain: "product",
    brandId: brand.id,
    name: "User-edited product",
    payload: object.payload,
  });
  await processCatalogAnalysis("lab-worker");
  assert.equal(
    (await pg.query("SELECT name FROM catalog_items WHERE id=$1", [object.id]))
      .rows[0].name,
    "User-edited product",
  );
  assert.equal(
    (
      await pg.query("SELECT status FROM catalog_jobs WHERE object_id=$1", [
        object.id,
      ])
    ).rows[0].status,
    "conflict",
  );
  const scoped = { ...actor, allBrands: false, brandIds: [] };
  await assert.rejects(
    () =>
      uploadCatalogFile(
        scoped,
        { objectId: object.id, expectedRevision: object.revision },
        new File([png], "p.png"),
      ),
    { code: "BRAND_ACCESS_DENIED" },
  );
});

test("running G-Labs task stays on original endpoint after connection rotation", async () => {
  const item = (await pg.query("SELECT * FROM content_items LIMIT 1")).rows[0];
  const old = await saveConnection(actor, {
    kind: "glabs",
    label: "Old route",
    config: {
      baseUrl: "https://old-provider.example.test/",
      delayEnabled: false,
      maxConcurrent: 10,
    },
    secret: { apiKey: "TEST_MOCK_API_KEY" },
  });
  const pkg = {
    tenantId: actor.tenantId,
    itemId: item.id,
    revision: item.revision,
  };
  let posts = 0;
  await assert.rejects(
    () =>
      providerJob(pkg, old, "route", "routing_test", { n: 1 }, async () => {
        posts++;
        return { task_id: "route-test" };
      }),
    { code: "PIPELINE_PENDING" },
  );
  const next = await saveConnection(actor, {
    kind: "glabs",
    label: "New route",
    config: {
      baseUrl: "https://new-provider.example.test/",
      delayEnabled: false,
      maxConcurrent: 10,
    },
    secret: { apiKey: "TEST_MOCK_API_KEY" },
  });
  const original = gateway.fetch;
  const hosts = [];
  gateway.fetch = async (url, options) => {
    hosts.push(new URL(url).hostname);
    return original(url, options);
  };
  try {
    const output = await providerJob(
      pkg,
      next,
      "route",
      "routing_test",
      { n: 1 },
      async () => {
        posts++;
        return {};
      },
    );
    assert.equal(output._cfConnectionId, old.id);
    assert.deepEqual(hosts, [
      "old-provider.example.test",
      "old-provider.example.test",
    ]);
    assert.equal(posts, 1);
  } finally {
    gateway.fetch = original;
  }
});

test("Drive public-access failure prevents Repliz POST and keeps content production ready", async () => {
  const item = (
    await pg.query(
      "SELECT * FROM content_items WHERE source_kind='recipe_video' AND status='ready' LIMIT 1",
    )
  ).rows[0];
  assert.ok(item);
  await approveFinal(actor, item.id, item.revision);
  const intent = await createPublishingIntent(
    actor,
    item.id,
    {
      revision: item.revision,
      accountId: "account",
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    },
    "blocked-drive",
  );
  const before = replizPosts;
  google.faults.html = true;
  await processPublishing("blocked-drive-worker");
  google.faults.html = false;
  const row = (
    await pg.query(
      "SELECT status,error_code FROM publishing_intents WHERE id=$1",
      [intent.id],
    )
  ).rows[0];
  assert.equal(row.status, "failed");
  assert.equal(row.error_code, "DRIVE_DOWNLOAD_NOT_PUBLIC");
  assert.equal(replizPosts, before);
  assert.equal(
    (await pg.query("SELECT status FROM content_items WHERE id=$1", [item.id]))
      .rows[0].status,
    "ready",
  );
});
