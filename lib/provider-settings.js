import { getPool, transaction } from "./db-pg.js";
import { saveConnection, resolveConnection } from "./connections.js";
import { requireIntegrationAdmin, poolSettings } from "./gemini-pool.js";
import { gateway, pcmToWav } from "./provider-gateway.js";
import { saveArtifact } from "./artifact-store.js";
import { StudioError } from "./errors.js";
import { audit } from "./idempotency.js";
export async function productionDefaults(db, tenantId) {
  const rows = (
    await db.query(
      "SELECT kind,config FROM integration_settings WHERE tenant_id=$1",
      [tenantId],
    )
  ).rows;
  const values = Object.fromEntries(rows.map((r) => [r.kind, r.config]));
  return {
    plannerModel: values.gemini?.model,
    geminiTtsModel: values.gemini?.ttsModel,
    workflow: {
      voice_provider: "minimax",
      ...(values.minimax?.voice ? { voice_persona: values.minimax.voice } : {}),
      ...(values.minimax?.model
        ? { tts_model_quality: values.minimax.model }
        : {}),
      gemini_fallback_enabled: values.minimax?.fallback !== false,
    },
    visual_engine: {
      ...(values.glabs?.imageModel
        ? { image_model: values.glabs.imageModel }
        : {}),
      ...(values.glabs?.videoModel
        ? { video_model: values.glabs.videoModel }
        : {}),
    },
  };
}
export async function listProviderSettings(actor) {
  requireIntegrationAdmin(actor);
  return Object.fromEntries(
    (
      await getPool().query(
        "SELECT kind,config,revision FROM integration_settings WHERE tenant_id=$1",
        [actor.tenantId],
      )
    ).rows.map((r) => [r.kind, { ...r.config, revision: r.revision }]),
  );
}
export async function saveProviderSettings(actor, input) {
  requireIntegrationAdmin(actor);
  if (!["minimax", "glabs", "repliz"].includes(input.kind))
    throw new StudioError("SETTING_INVALID", "Jenis pengaturan tidak valid.");
  let config = {};
  if (input.kind === "glabs") {
    const min = Number(input.config.delayMin ?? 10),
      max = Number(input.config.delayMax ?? 20),
      parallel = Number(input.config.maxConcurrent ?? 2);
    if (
      !Number.isFinite(min) ||
      min < 0 ||
      max < min ||
      max > 300 ||
      !Number.isInteger(parallel) ||
      parallel < 1 ||
      parallel > 10 ||
      !["threading", "sequential"].includes(
        input.config.t2iPattern || "threading",
      )
    )
      throw new StudioError(
        "GLABS_SETTING_INVALID",
        "Jeda/pola/batas pekerjaan tidak valid.",
      );
    config = {
      baseUrl: input.config.baseUrl,
      imageModel: input.config.imageModel,
      videoModel: input.config.videoModel,
      delayMin: min,
      delayMax: max,
      maxConcurrent: parallel,
      t2iPattern: input.config.t2iPattern || "threading",
      delayEnabled: input.config.delayEnabled !== false,
    };
  } else if (input.kind === "minimax")
    config = {
      baseUrl: input.config.baseUrl,
      model: input.config.model || "speech-2.8-turbo",
      voice: input.config.voice || "Indonesian_casual_reporter_vv2",
      fallback: input.config.fallback !== false,
    };
  else config = { baseUrl: input.config.baseUrl || "https://api.repliz.com/" };
  const connection = await saveConnection(actor, {
    kind: input.kind,
    label: input.label || input.kind.toUpperCase() + " tenant",
    config,
    secret: input.secret || {},
  });
  await getPool().query(
    `INSERT INTO integration_settings(tenant_id,kind,config) VALUES($1,$2,$3) ON CONFLICT(tenant_id,kind) DO UPDATE SET config=EXCLUDED.config,revision=integration_settings.revision+1`,
    [actor.tenantId, input.kind, config],
  );
  return { connection, config };
}
export async function testProviderSettings(actor, kind) {
  requireIntegrationAdmin(actor);
  if (!["glabs", "minimax", "repliz"].includes(kind))
    throw new StudioError("SETTING_INVALID", "Jenis tes tidak valid.");
  const c = await resolveConnection(actor.tenantId, null, kind);
  if (kind === "glabs") {
    await gateway.json(c, "GET", "api/health", null, { readOnly: true });
    return { ok: true, checkedAt: new Date().toISOString() };
  }
  if (kind === "repliz") {
    const data = await gateway.json(
      c,
      "GET",
      "public/account?page=1&limit=100",
      null,
      { readOnly: true },
    );
    return {
      ok: true,
      accountCount: (Array.isArray(data) ? data : data.docs || data.data || [])
        .length,
    };
  }
  const result = await gateway.json(
    c,
    "POST",
    "v1/t2a_v2",
    {
      model: c.config.model || "speech-2.8-turbo",
      text: "Ini uji suara CF Studio.",
      stream: false,
      voice_setting: {
        voice_id: c.config.voice || "Indonesian_casual_reporter_vv2",
        speed: 1,
        vol: 1,
      },
      audio_setting: { sample_rate: 32000, format: "mp3", channel: 1 },
      output_format: "hex",
    },
    { configurationTest: true },
  );
  if (result.base_resp?.status_code || !result.data?.audio)
    throw new StudioError(
      "TTS_FAILED",
      "MiniMax belum menghasilkan suara uji.",
    );
  const a = await saveArtifact({
    tenantId: actor.tenantId,
    objectId: c.id,
    revision: c.revision,
    kind: "connection_test",
    buffer: Buffer.from(result.data.audio, "hex"),
    mimeType: "audio/mpeg",
    extension: "mp3",
  });
  return { ok: true, audioUrl: "/api/v3/media/" + actor.tenantId + "/" + a.id };
}
export async function reserveGlabsLane(connection) {
  const cfg = connection.config || {},
    parallel = Number(cfg.maxConcurrent || 2);
  return transaction(async (db) => {
    await db.query(
      "INSERT INTO provider_dispatch_lanes(tenant_id,connection_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [connection.tenant_id, connection.id],
    );
    const lane = (
      await db.query(
        "SELECT * FROM provider_dispatch_lanes WHERE tenant_id=$1 AND connection_id=$2 FOR UPDATE",
        [connection.tenant_id, connection.id],
      )
    ).rows[0];
    const running = (
      await db.query(
        `SELECT count(*)::int AS n FROM provider_jobs WHERE tenant_id=$1 AND connection_id=$2 AND status IN('running','submitting')`,
        [connection.tenant_id, connection.id],
      )
    ).rows[0].n;
    if (running > parallel || new Date(lane.next_submit_at) > new Date())
      throw new StudioError(
        "GLABS_PACING_WAIT",
        "Menunggu slot pengiriman G-Labs.",
        503,
      );
    const delay =
      cfg.delayEnabled === false
        ? 0
        : Number(cfg.delayMin ?? 10) +
          Math.random() *
            (Number(cfg.delayMax ?? 20) - Number(cfg.delayMin ?? 10));
    await db.query(
      "UPDATE provider_dispatch_lanes SET next_submit_at=$3 WHERE tenant_id=$1 AND connection_id=$2",
      [
        connection.tenant_id,
        connection.id,
        new Date(Date.now() + delay * 1000),
      ],
    );
    return true;
  });
}
