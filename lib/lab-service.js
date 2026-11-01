import { randomUUID } from "node:crypto";
import { getPool, transaction } from "./db-pg.js";
import { requireCatalog, saveCatalog } from "./catalog-service.js";
import { assertAccess } from "./access-control.js";
import { saveArtifact, loadArtifact } from "./artifact-store.js";
import { StudioError } from "./errors.js";
import { actorForUser } from "./operations-service.js";
import { resolveConnection } from "./connections.js";
import { gateway, requireDispatch } from "./provider-gateway.js";
import { queueNotification } from "./notification-service.js";
import { audit } from "./idempotency.js";
export async function uploadCatalogFile(actor, input, file) {
  const object = await requireCatalog(
    getPool(),
    actor,
    input.objectId,
    "catalog.manage",
  );
  if (
    !["product", "deconstruct", "visual_identity"].includes(object.domain) ||
    object.revision !== Number(input.expectedRevision)
  )
    throw new StudioError(
      "STALE_REVISION",
      "Objek berubah. Buka kembali detail.",
      409,
    );
  if (
    !file ||
    typeof file.arrayBuffer !== "function" ||
    file.size > 20 * 1024 * 1024 ||
    file.size === 0
  )
    throw new StudioError("FILE_INVALID", "File wajib dan maksimal 20 MB.");
  const buffer = Buffer.from(await file.arrayBuffer());
  const png = buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    jpg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255,
    webp =
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP",
    mp4 = buffer.toString("ascii", 4, 8) === "ftyp";
  const mime = png
    ? "image/png"
    : jpg
      ? "image/jpeg"
      : webp
        ? "image/webp"
        : mp4
          ? "video/mp4"
          : null;
  if (
    !mime ||
    (object.domain === "deconstruct" && !mp4) ||
    (object.domain !== "deconstruct" && mp4)
  )
    throw new StudioError(
      "FILE_TYPE_INVALID",
      "Gunakan MP4 untuk Deconstruct, PNG/JPEG/WebP untuk foto.",
    );
  const asset = await saveArtifact({
    tenantId: actor.tenantId,
    brandId: object.brand_id,
    objectId: object.id,
    revision: object.revision + 1,
    kind: mp4 ? "deconstruct_source" : "reference_photo",
    buffer,
    mimeType: mime,
    extension: mp4 ? "mp4" : png ? "png" : jpg ? "jpg" : "webp",
  });
  const ref = { assetId: asset.id, sha256: asset.sha256, mimeType: mime };
  const payload = {
    ...object.payload,
    ...(mp4
      ? { videoArtifactId: ref, status: "pending" }
      : object.domain === "product"
        ? { photoArtifactId: ref, photo_status: "needs_review" }
        : { imageArtifactId: ref }),
  };
  return saveCatalog(actor, {
    id: object.id,
    expectedRevision: object.revision,
    domain: object.domain,
    brandId: object.brand_id,
    name: object.name,
    payload,
  });
}
export async function approveProductPhoto(actor, id, revision) {
  const object = await requireCatalog(getPool(), actor, id, "catalog.manage");
  if (
    object.domain !== "product" ||
    object.revision !== revision ||
    !object.payload.photoArtifactId
  )
    throw new StudioError(
      "PHOTO_NOT_READY",
      "Foto atau versi tidak cocok.",
      409,
    );
  const { asset } = await loadArtifact(
    actor.tenantId,
    object.payload.photoArtifactId.assetId,
  );
  if (
    asset.object_id !== object.id ||
    asset.sha256 !== object.payload.photoArtifactId.sha256
  )
    throw new StudioError("PHOTO_MISMATCH", "Referensi foto tidak cocok.");
  return saveCatalog(actor, {
    id,
    expectedRevision: revision,
    domain: "product",
    brandId: object.brand_id,
    name: object.name,
    payload: {
      ...object.payload,
      photo_status: "approved",
      photo_reviewed_at: new Date().toISOString(),
      photo_reviewed_by: actor.id,
    },
  });
}
export async function queueCatalogAnalysis(actor, id, revision) {
  return transaction(async (db) => {
    const object = await requireCatalog(db, actor, id, "catalog.manage");
    assertAccess(
      actor,
      { tenantId: actor.tenantId, brandId: object.brand_id },
      "production.run",
    );
    if (
      !["product", "deconstruct"].includes(object.domain) ||
      object.revision !== revision
    )
      throw new StudioError(
        "STALE_REVISION",
        "Objek atau versi tidak cocok.",
        409,
      );
    if (object.domain === "deconstruct" && !object.payload.videoArtifactId)
      throw new StudioError(
        "VIDEO_REQUIRED",
        "Unggah video MP4 sebelum analisis. Media sumber migrasi yang hilang tidak dapat dianalisis ulang.",
      );
    const row = (
      await db.query(
        `INSERT INTO catalog_jobs(id,tenant_id,object_id,brand_id,revision,actor_id,input) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,object_id,revision) DO UPDATE SET input=catalog_jobs.input RETURNING *`,
        [
          randomUUID(),
          actor.tenantId,
          id,
          object.brand_id,
          revision,
          actor.id,
          {
            snapshot: object,
            geminiConfig:
              (
                await db.query(
                  "SELECT config FROM integration_settings WHERE tenant_id=$1 AND kind='gemini'",
                  [actor.tenantId],
                )
              ).rows[0]?.config || null,
          },
        ],
      )
    ).rows[0];
    await audit(
      db,
      actor,
      "catalog.analysis_queued",
      { jobId: row.id, objectId: id, revision },
      object.brand_id,
    );
    return row;
  });
}
export async function listCatalogJobs(actor) {
  assertAccess(actor, { tenantId: actor.tenantId }, "catalog.read");
  return (
    await getPool().query(
      "SELECT id,object_id,revision,status,error_code,created_at FROM catalog_jobs WHERE tenant_id=$1 AND ($2::boolean OR brand_id=ANY($3::text[])) ORDER BY created_at DESC LIMIT 100",
      [actor.tenantId, actor.allBrands, actor.brandIds],
    )
  ).rows;
}
export async function processCatalogAnalysis(workerId) {
  requireDispatch("production");
  const db = getPool();
  await db.query(
    `UPDATE catalog_jobs SET status='unknown',error_code='PROVIDER_OUTCOME_UNKNOWN' WHERE status='submitting' AND lease_expires_at<now()`,
  );
  const job = await transaction(async (tx) => {
    const row = (
      await tx.query(
        `SELECT j.id FROM catalog_jobs j JOIN tenants t ON t.id=j.tenant_id WHERE j.status='queued' AND t.status='active' ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1`,
      )
    ).rows[0];
    if (!row) return null;
    return (
      await tx.query(
        `UPDATE catalog_jobs SET status='submitting',lease_owner=$2,lease_expires_at=now()+interval '5 minutes' WHERE id=$1 RETURNING *`,
        [row.id, workerId],
      )
    ).rows[0];
  });
  if (!job) return false;
  const object = job.input.snapshot;
  let result,
    status = "completed",
    error = null;
  try {
    const actor = await actorForUser(db, job.actor_id);
    assertAccess(
      actor,
      { tenantId: job.tenant_id, brandId: job.brand_id },
      "catalog.manage",
    );
    assertAccess(
      actor,
      { tenantId: job.tenant_id, brandId: job.brand_id },
      "production.run",
    );
    let connection = await resolveConnection(
      job.tenant_id,
      job.brand_id,
      "gemini",
    );
    if (job.input.geminiConfig)
      connection = {
        ...connection,
        config: { ...connection.config, ...job.input.geminiConfig },
      };
    let prompt,
      parts = [];
    if (object.domain === "deconstruct") {
      const { asset, buffer } = await loadArtifact(
        job.tenant_id,
        object.payload.videoArtifactId.assetId,
      );
      if (
        asset.object_id !== object.id ||
        asset.sha256 !== object.payload.videoArtifactId.sha256
      )
        throw new StudioError(
          "REFERENCE_MISMATCH",
          "Video sumber tidak cocok.",
        );
      parts = [
        {
          inlineData: {
            mimeType: asset.mime_type,
            data: buffer.toString("base64"),
          },
        },
      ];
      prompt =
        "Analyze this video for MAKNA Deconstruct Lab. Return JSON {title,hook,narrative_pattern,video_dna,scenes:[{id,start_time,end_time,scene_function,visual_description,voice_over,camera,motion,lighting,transition,image_prompt,video_prompt}]}. Describe observed footage accurately. Transcribe audible narration in its original language. Separate scene boundaries and narrative beats. Include all 10 video DNA parameters: pilar_konten,hook_type,visual_style,signature_moment,camera_pace,primary_emotion,affiliate_integration,affiliate_mention,scene_count,cta_type. Do not invent product facts.";
    } else
      prompt =
        "Extract only verifiable product facts from the supplied text. Do not browse URLs or invent claims. Return JSON {product_name,product_description,category,unique_selling_point,pain_point_solved,target_audience,product_truth,geometric_truth}. Input: " +
        JSON.stringify({
          name: object.name,
          text:
            object.payload.raw_description ||
            object.payload.product_description ||
            "",
          sourceUrl: object.payload.source_url || "",
        });
    result = await gateway.gemini(connection, prompt, {
      parts,
      module: object.domain === "deconstruct" ? "deconstruct" : "extraction",
    });
    if (
      object.domain === "deconstruct" &&
      (!Array.isArray(result.scenes) || !result.scenes.length)
    )
      throw new StudioError(
        "ANALYSIS_INVALID",
        "Analisis belum menghasilkan storyboard.",
      );
    const payload =
      object.domain === "deconstruct"
        ? {
            ...object.payload,
            original_storyboard_json: result.scenes,
            deconstruct_analysis: result,
            status: "deconstructed",
          }
        : {
            ...object.payload,
            ...Object.fromEntries(
              Object.entries(result).filter(([k]) =>
                [
                  "product_name",
                  "product_description",
                  "category",
                  "unique_selling_point",
                  "pain_point_solved",
                  "target_audience",
                  "product_truth",
                  "geometric_truth",
                ].includes(k),
              ),
            ),
            extraction_status: "completed",
          };
    const lease = await db.query(
      `SELECT 1 FROM catalog_jobs WHERE id=$1 AND status='submitting' AND lease_owner=$2 AND lease_expires_at>now()`,
      [job.id, workerId],
    );
    if (!lease.rowCount)
      throw new StudioError("STALE_LEASE", "Job sudah tidak aktif.", 409);
    const freshActor = await actorForUser(db, job.actor_id);
    await saveCatalog(freshActor, {
      id: object.id,
      expectedRevision: job.revision,
      domain: object.domain,
      brandId: object.brand_id,
      name: result.product_name || result.title || object.name,
      payload,
    });
  } catch (e) {
    error = e.code || "CATALOG_ANALYSIS_FAILED";
    status = ["PROVIDER_OUTCOME_UNKNOWN", "PROVIDER_INVALID_RESPONSE"].includes(
      error,
    )
      ? "unknown"
      : error === "STALE_REVISION"
        ? "conflict"
        : "failed";
  }
  await transaction(async (tx) => {
    const saved = await tx.query(
      `UPDATE catalog_jobs SET status=$3,result=$4,error_code=$5,lease_owner=NULL,lease_expires_at=NULL WHERE id=$1 AND lease_owner=$2 AND lease_expires_at>now()`,
      [job.id, workerId, status, result || null, error],
    );
    if (saved.rowCount)
      await queueNotification(tx, {
        tenantId: job.tenant_id,
        brandId: job.brand_id,
        eventKey: "catalog:" + job.id + ":" + status,
        eventType: status === "completed" ? "ready" : "error",
        message:
          "CF Studio • " +
          (object.domain === "deconstruct"
            ? "Deconstruct Lab"
            : "Product Database") +
          " • " +
          (status === "completed"
            ? "Analisis selesai."
            : "Analisis perlu pemeriksaan: " + status) +
          ". Buka detail di aplikasi.",
      });
  });
  return true;
}
