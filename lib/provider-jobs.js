import { randomUUID } from "node:crypto";
import { getPool } from "./db-pg.js";
import { fingerprint } from "./production-package.js";
import { StudioError } from "./errors.js";
import { reserveGlabsLane } from "./provider-settings.js";
import { gateway } from "./provider-gateway.js";
import { connectionById } from "./connections.js";
export class PipelinePending extends Error {
  constructor() {
    super("PIPELINE_PENDING");
    this.code = "PIPELINE_PENDING";
  }
}
// Persist uncertainty before dispatch. A crash after POST never causes an automatic second POST.
export async function providerJob(
  pkg,
  connection,
  sceneId,
  stage,
  payload,
  perform,
) {
  const db = getPool(),
    hash = fingerprint(payload);
  await db.query(
    `INSERT INTO provider_jobs(id,tenant_id,connection_id,item_id,revision,scene_id,stage,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
    [
      randomUUID(),
      pkg.tenantId,
      connection.id,
      pkg.itemId,
      pkg.revision,
      sceneId,
      stage,
      hash,
    ],
  );
  let job = (
    await db.query(
      "SELECT * FROM provider_jobs WHERE tenant_id=$1 AND item_id=$2 AND revision=$3 AND scene_id=$4 AND stage=$5",
      [pkg.tenantId, pkg.itemId, pkg.revision, sceneId, stage],
    )
  ).rows[0];
  if (job.request_hash !== hash)
    throw new StudioError(
      "JOB_INPUT_CHANGED",
      "Input tahap berbeda dari revisi yang sudah dikirim.",
      409,
    );
  const withRoute = (value) =>
    connection.kind === "glabs"
      ? { ...value, _cfConnectionId: job.connection_id }
      : value;
  if (job.status === "completed") return withRoute(job.result);
  if (["submitting", "unknown"].includes(job.status))
    throw new StudioError(
      "PROVIDER_OUTCOME_UNKNOWN",
      "Hasil provider perlu direkonsiliasi sebelum mencoba ulang.",
      409,
    );
  if (job.status === "failed")
    throw new StudioError(
      job.error_code || "PROVIDER_JOB_FAILED",
      "Job provider gagal. Buat revisi baru setelah memeriksa penyebab.",
    );
  if (job.status === "prepared") {
    if (job.connection_id !== connection.id)
      throw new StudioError(
        "PROVIDER_ROUTE_CHANGED",
        "Koneksi job belum dikirim berubah. Buat revisi baru agar route eksplisit.",
        409,
      );
    const claimed = await db.query(
      `UPDATE provider_jobs SET status='submitting',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='prepared' RETURNING id`,
      [pkg.tenantId, job.id],
    );
    if (!claimed.rowCount) throw new PipelinePending();
    try {
      if (connection.kind === "glabs")
        await reserveGlabsLane({ ...connection, tenant_id: pkg.tenantId });
      const result = await perform();
      if (result.task_id) {
        await db.query(
          `UPDATE provider_jobs SET status='running',provider_id=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
          [pkg.tenantId, job.id, String(result.task_id)],
        );
        throw new PipelinePending();
      }
      await db.query(
        `UPDATE provider_jobs SET status='completed',result=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [pkg.tenantId, job.id, result],
      );
      return withRoute(result);
    } catch (e) {
      if (e.code === "PIPELINE_PENDING") throw e;
      await db.query(
        `UPDATE provider_jobs SET status=$3,error_code=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [
          pkg.tenantId,
          job.id,
          ["PROVIDER_OUTCOME_UNKNOWN", "PROVIDER_INVALID_RESPONSE"].includes(
            e.code,
          )
            ? "unknown"
            : [
                  "PROVIDER_RATE_LIMIT",
                  "GEMINI_POOL_UNAVAILABLE",
                  "GEMINI_MODEL_BUSY",
                  "GLABS_PACING_WAIT",
                ].includes(e.code)
              ? "prepared"
              : "failed",
          e.code || "PROVIDER_FAILED",
        ],
      );
      throw e;
    }
  }
  if (job.connection_id !== connection.id)
    connection = await connectionById(pkg.tenantId, job.connection_id);
  const status = await gateway.json(
    connection,
    "GET",
    "api/status/" + encodeURIComponent(job.provider_id),
    null,
    { readOnly: true },
  );
  if (["failed", "error"].includes(status.status)) {
    await db.query(
      `UPDATE provider_jobs SET status='failed',error_code='PROVIDER_JOB_FAILED' WHERE tenant_id=$1 AND id=$2`,
      [pkg.tenantId, job.id],
    );
    throw new StudioError("PROVIDER_JOB_FAILED", "Job G-Labs gagal.");
  }
  if (!["succeeded", "completed", "success"].includes(status.status))
    throw new PipelinePending();
  const result = await gateway.json(
    connection,
    "GET",
    "api/result/" + encodeURIComponent(job.provider_id),
    null,
    { readOnly: true },
  );
  await db.query(
    `UPDATE provider_jobs SET status='completed',result=$3 WHERE tenant_id=$1 AND id=$2`,
    [pkg.tenantId, job.id, result],
  );
  return withRoute(result);
}
