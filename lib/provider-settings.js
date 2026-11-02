import {
  normalizeGlabsConfig,
  workerIdentity,
  diagnoseGlabs,
} from "./glabs-settings.js";
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
    geminiConfig: values.gemini || null,
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
    const previous =
      (
        await getPool().query(
          "SELECT config FROM integration_settings WHERE tenant_id=$1 AND kind='glabs'",
          [actor.tenantId],
        )
      ).rows[0]?.config ||
      (
        await getPool().query(
          "SELECT config FROM connections WHERE tenant_id=$1 AND kind='glabs' AND brand_id IS NULL AND status='configured' LIMIT 1",
          [actor.tenantId],
        )
      ).rows[0]?.config ||
      {};
    if (typeof input.secret?.apiKey === "string")
      input = {
        ...input,
        secret: { ...input.secret, apiKey: input.secret.apiKey.trim() },
      };
    config = normalizeGlabsConfig(input.config, previous);
  } else if (input.kind === "minimax") {
    if (typeof input.secret?.apiKey === "string")
      input = {
        ...input,
        secret: { ...input.secret, apiKey: input.secret.apiKey.trim() },
      };
    const old =
      (
        await getPool().query(
          "SELECT config FROM integration_settings WHERE tenant_id=$1 AND kind='minimax'",
          [actor.tenantId],
        )
      ).rows[0]?.config ||
      (
        await getPool().query(
          "SELECT config FROM connections WHERE tenant_id=$1 AND kind='minimax' AND brand_id IS NULL AND status='configured' LIMIT 1",
          [actor.tenantId],
        )
      ).rows[0]?.config ||
      {};
    const supplied = input.config || {};
    config = {
      baseUrl: "https://api.minimax.io/",
      model: supplied.model || old.model || "speech-2.8-turbo",
      voice: supplied.voice || old.voice || "Indonesian_casual_reporter_vv2",
      fallback:
        supplied.fallback === undefined
          ? old.fallback !== false
          : supplied.fallback !== false,
      ...(old.voices ? { voices: old.voices } : {}),
    };
  } else
    config = { baseUrl: input.config.baseUrl || "https://api.repliz.com/" };
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
    return diagnoseGlabs(c.config, c.secret.apiKey);
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
export async function testGlabsDraft(actor, input) {
  requireIntegrationAdmin(actor);
  const config = normalizeGlabsConfig(input.config);
  let key = input.secret?.apiKey?.trim();
  if (!key) {
    try {
      key = (await resolveConnection(actor.tenantId, null, "glabs")).secret
        .apiKey;
    } catch (e) {
      if (e.code !== "CONNECTION_REQUIRED") throw e;
    }
  }
  return diagnoseGlabs(config, key);
}
export async function reserveGlabsLane(connection, jobId = null) {
  const cfg = connection.config || {},
    worker = workerIdentity(cfg.baseUrl);
  return transaction(async (db) => {
    const connections = (
      await db.query(
        "SELECT id,config FROM connections WHERE tenant_id=$1 AND kind='glabs'",
        [connection.tenant_id],
      )
    ).rows;
    const ids = connections
      .filter((c) => {
        try {
          return workerIdentity(c.config.baseUrl) === worker;
        } catch {
          return false;
        }
      })
      .map((c) => c.id);
    await db.query(
      `INSERT INTO glabs_worker_lanes(tenant_id,worker,next_submit_at) SELECT $1,$2,COALESCE(max(next_submit_at),now()) FROM provider_dispatch_lanes WHERE tenant_id=$1 AND connection_id=ANY($3::text[]) ON CONFLICT DO NOTHING`,
      [connection.tenant_id, worker, ids],
    );
    const lane = (
      await db.query(
        "SELECT * FROM glabs_worker_lanes WHERE tenant_id=$1 AND worker=$2 FOR UPDATE",
        [connection.tenant_id, worker],
      )
    ).rows[0];
    const running = (
      await db.query(
        `SELECT count(*)::int AS n FROM provider_jobs WHERE tenant_id=$1 AND connection_id=ANY($2::text[]) AND status IN('running','submitting','unknown') AND ($3::text IS NULL OR id<>$3)`,
        [connection.tenant_id, ids, jobId],
      )
    ).rows[0].n;
    const stage = jobId
      ? (
          await db.query(
            "SELECT stage FROM provider_jobs WHERE tenant_id=$1 AND id=$2",
            [connection.tenant_id, jobId],
          )
        ).rows[0]?.stage
      : "start_frames";
    const cap =
      cfg.t2iPattern === "sequential" && stage === "start_frames"
        ? 1
        : Number(cfg.maxConcurrent || 2);
    if (running >= cap || new Date(lane.next_submit_at) > new Date())
      throw new StudioError(
        "GLABS_PACING_WAIT",
        "Menunggu slot pengiriman G-Labs.",
        503,
      );
    const delay =
      cfg.delayEnabled === false
        ? 0
        : Number(cfg.delayMin ?? 10) +
          Math.floor(
            Math.random() *
              (Number(cfg.delayMax ?? 20) - Number(cfg.delayMin ?? 10) + 1),
          );
    await db.query(
      "UPDATE glabs_worker_lanes SET next_submit_at=$3 WHERE tenant_id=$1 AND worker=$2",
      [connection.tenant_id, worker, new Date(Date.now() + delay * 1000)],
    );
    if (jobId)
      await db.query(
        "UPDATE provider_jobs SET dispatch_delay_seconds=$3 WHERE tenant_id=$1 AND id=$2",
        [connection.tenant_id, jobId, delay],
      );
    return true;
  });
}
export async function completeGlabsJob(db, job, connection, result) {
  await db.query(
    "UPDATE provider_jobs SET status='completed',result=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",
    [job.tenant_id, job.id, result],
  );
  if (
    connection.kind === "glabs" &&
    connection.config.t2iPattern === "sequential" &&
    job.stage === "start_frames"
  ) {
    const worker = workerIdentity(connection.config.baseUrl);
    await db.query(
      `UPDATE glabs_worker_lanes SET next_submit_at=GREATEST(next_submit_at,now()+($3 * interval '1 second')) WHERE tenant_id=$1 AND worker=$2`,
      [
        job.tenant_id,
        worker,
        job.dispatch_delay_seconds ??
          (connection.config.delayEnabled === false
            ? 0
            : Number(connection.config.delayMax ?? 20)),
      ],
    );
  }
}
