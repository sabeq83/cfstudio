import { randomUUID } from "node:crypto";
import { getPool, transaction } from "./db-pg.js";
import { assertAccess } from "./access-control.js";
import { actorForUser } from "./operations-service.js";
import { createRun } from "./automation-service.js";
import { nextRunAt } from "./schedule.js";
import {
  buildPlannerPrompt,
  buildCreativePrompt,
  normalizeCreative,
} from "./production-adapters.js";
import { resolveConnection } from "./connections.js";
import { gateway, requireDispatch } from "./provider-gateway.js";
import { providerJob, PipelinePending } from "./provider-jobs.js";
import { mediaServices } from "./media-services.js";
import { executePackage } from "./shared-pipeline.js";
import { queueNotification } from "./notification-service.js";
import { incidentKey, safeIncidentMessage } from "./incidents.js";
import { StudioError } from "./errors.js";
export async function scheduleDue(now = new Date()) {
  requireDispatch("production");
  return transaction(async (db) => {
    const routines = (
      await db.query(
        `SELECT r.* FROM routines r JOIN tenants t ON t.id=r.tenant_id WHERE r.state='active' AND r.next_run_at<=$1 AND t.status='active' ORDER BY r.next_run_at FOR UPDATE OF r SKIP LOCKED LIMIT 20`,
        [now],
      )
    ).rows;
    let n = 0;
    for (const r of routines) {
      try {
        const actor = await actorForUser(db, r.created_by);
        assertAccess(
          actor,
          { tenantId: r.tenant_id, brandId: r.brand_id },
          "production.run",
        );
        const late = now.getTime() - new Date(r.next_run_at).getTime();
        const skip =
          r.active_config.missedSlotPolicy === "skip" && late > 60000;
        if (!skip) {
          await createRun(db, actor, r, r.active_config, {
            mode: "scheduled",
            slot: r.next_run_at,
          });
          n++;
        }
        await db.query(
          "UPDATE routines SET next_run_at=$3 WHERE tenant_id=$1 AND id=$2",
          [r.tenant_id, r.id, nextRunAt(r.active_config, now)],
        );
      } catch (e) {
        if (e.status !== 403) throw e;
        await db.query(
          `UPDATE routines SET state='paused',next_run_at=NULL WHERE tenant_id=$1 AND id=$2`,
          [r.tenant_id, r.id],
        );
      }
    }
    return n;
  });
}
export async function claimRun(workerId) {
  return transaction(async (db) => {
    const row = (
      await db.query(
        `SELECT r.id FROM automation_runs r JOIN tenants t ON t.id=r.tenant_id WHERE t.status='active' AND ((r.status='queued' AND (r.next_attempt_at IS NULL OR r.next_attempt_at<=now())) OR (r.status='processing' AND r.lease_expires_at<now())) ORDER BY r.created_at FOR UPDATE OF r SKIP LOCKED LIMIT 1`,
      )
    ).rows[0];
    if (!row) return null;
    return (
      await db.query(
        `UPDATE automation_runs SET status='processing',lease_owner=$2,lease_expires_at=now()+interval '5 minutes',fencing_token=fencing_token+1,attempt_count=attempt_count+1 WHERE id=$1 RETURNING *`,
        [row.id, workerId],
      )
    ).rows[0];
  });
}
async function assertLease(run) {
  const r = await getPool().query(
    `SELECT 1 FROM automation_runs WHERE id=$1 AND tenant_id=$2 AND lease_owner=$3 AND fencing_token=$4 AND lease_expires_at>now()`,
    [run.id, run.tenant_id, run.lease_owner, run.fencing_token],
  );
  if (!r.rowCount)
    throw new StudioError("STALE_LEASE", "Worker sudah digantikan.", 409);
}
export async function processProduction(workerId) {
  requireDispatch("production");
  const run = await claimRun(workerId);
  if (!run) return false;
  const db = getPool();
  const heartbeat = setInterval(() => {
    db.query(
      `UPDATE automation_runs SET lease_expires_at=now()+interval '5 minutes' WHERE id=$1 AND lease_owner=$2 AND fencing_token=$3 AND lease_expires_at>now()`,
      [run.id, workerId, run.fencing_token],
    ).catch(() => {});
  }, 30000);
  try {
    const items = (
      await db.query(
        `SELECT * FROM content_items WHERE tenant_id=$1 AND run_id=$2 AND status NOT IN('ready','archived') ORDER BY id`,
        [run.tenant_id, run.id],
      )
    ).rows;
    for (const item of items) {
      const actor = await actorForUser(db, item.created_by || run.actor_id);
      let stage = "planning";
      try {
        assertAccess(
          actor,
          { tenantId: item.tenant_id, brandId: item.brand_id },
          "production.run",
        );
        if (
          ["failed", "awaiting_creative_approval"].includes(item.status) ||
          (item.status === "retry_wait" &&
            new Date(item.next_attempt_at) > new Date())
        )
          continue;
        await assertLease(run);
        const checkpoint = async (name, fn) => {
          stage = name;
          await assertLease(run);
          const freshActor = await actorForUser(
            db,
            item.created_by || run.actor_id,
          );
          assertAccess(
            freshActor,
            { tenantId: item.tenant_id, brandId: item.brand_id },
            "production.run",
          );
          const saved = (
            await db.query(
              "SELECT * FROM stage_executions WHERE tenant_id=$1 AND item_id=$2 AND revision=$3 AND stage=$4",
              [item.tenant_id, item.id, item.revision, name],
            )
          ).rows[0];
          if (saved?.status === "completed") return saved.output;
          await db.query(
            `INSERT INTO stage_executions(tenant_id,item_id,revision,stage,status,attempts) VALUES($1,$2,$3,$4,'processing',1) ON CONFLICT(tenant_id,item_id,revision,stage) DO UPDATE SET status='processing',attempts=stage_executions.attempts+1`,
            [item.tenant_id, item.id, item.revision, name],
          );
          const output = await fn();
          await assertLease(run);
          await db.query(
            `UPDATE stage_executions SET status='completed',output=$5,error_code=NULL WHERE tenant_id=$1 AND item_id=$2 AND revision=$3 AND stage=$4`,
            [item.tenant_id, item.id, item.revision, name, output],
          );
          return output;
        };
        let pkg = item.production_package;
        if (!pkg) {
          const target = item.target_config,
            brand = run.config.brandSnapshot;
          const conn = await resolveConnection(
            item.tenant_id,
            item.brand_id,
            "gemini",
          );
          const identity = target.identitySnapshot?.payload || null;
          const partial = {
            tenantId: item.tenant_id,
            brandId: item.brand_id,
            itemId: item.id,
            revision: item.revision,
          };
          const plan = await checkpoint("planning", () =>
            item.source_kind === "multiplier"
              ? Promise.resolve({
                  title: target.sourceSnapshot?.name,
                  hook: target.sourceSnapshot?.payload?.hook || "",
                  sourcePattern:
                    target.sourceSnapshot?.payload?.deconstruct_analysis
                      ?.narrative_pattern || null,
                })
              : providerJob(
                  partial,
                  conn,
                  "all",
                  "planning",
                  {
                    prompt: buildPlannerPrompt(item.source_kind, target, brand),
                  },
                  () =>
                    gateway.gemini(
                      conn,
                      buildPlannerPrompt(item.source_kind, target, brand),
                    ),
                ),
          );
          if (
            item.source_kind === "product_campaign" &&
            (!plan.cep || typeof plan.cep !== "string")
          )
            throw new StudioError(
              "CEP_MISSING",
              "Content Planner belum menghasilkan CEP.",
            );
          const response = await checkpoint("creative", () =>
            providerJob(
              partial,
              conn,
              "all",
              "creative",
              {
                prompt: buildCreativePrompt({
                  kind: item.source_kind,
                  target,
                  brand,
                  plan,
                  identity,
                }),
              },
              () =>
                gateway.gemini(
                  conn,
                  buildCreativePrompt({
                    kind: item.source_kind,
                    target,
                    brand,
                    plan,
                    identity,
                  }),
                ),
            ),
          );
          pkg = normalizeCreative({
            response,
            kind: item.source_kind,
            target,
            identity,
            ...partial,
            plan,
          });
          await db.query(
            "UPDATE content_items SET production_package=$3,caption=$4 WHERE tenant_id=$1 AND id=$2",
            [item.tenant_id, item.id, pkg, pkg.caption],
          );
        }
        const creativeGate = async () => {
          if (item.creative_decision?.revision === item.revision)
            return item.creative_decision;
          if (run.config.creativeApproval === "manual") {
            await db.query(
              `UPDATE content_items SET status='awaiting_creative_approval' WHERE tenant_id=$1 AND id=$2`,
              [item.tenant_id, item.id],
            );
            throw new StudioError(
              "CREATIVE_REVIEW_REQUIRED",
              "Materi kreatif menunggu review.",
            );
          }
          if (!item.target_config.presetSnapshot)
            throw new StudioError(
              "PRESET_REQUIRED",
              "Review otomatis memerlukan snapshot preset.",
            );
          const decision = {
            type: "preset",
            presetId: item.target_config.presetSnapshot.id,
            presetRevision: item.target_config.presetSnapshot.revision,
            revision: item.revision,
            fingerprint: pkg.fingerprint,
          };
          await db.query(
            "UPDATE content_items SET creative_decision=$3 WHERE tenant_id=$1 AND id=$2",
            [item.tenant_id, item.id, decision],
          );
          return decision;
        };
        if (pkg.outputKind === "static")
          await checkpoint("creative_gate", creativeGate);
        const baseServices = mediaServices(checkpoint);
        const services = Object.fromEntries(
          Object.entries(baseServices).map(([name, fn]) => [
            name,
            (p, c) => checkpoint(name, () => fn(p, c)),
          ]),
        );
        const output = await executePackage(pkg, services, {
          tenantId: item.tenant_id,
          creativeGate,
        });
        const artifacts =
          pkg.outputKind === "static"
            ? output.static_finishing
            : output.artifacts;
        await assertLease(run);
        await transaction(async (tx) => {
          await tx.query(
            `UPDATE content_items SET status='ready',artifacts=$3,error_code=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND revision=$4`,
            [item.tenant_id, item.id, artifacts, item.revision],
          );
          const recovered = await tx.query(
            `UPDATE pipeline_incidents SET status='recovered',updated_at=now() WHERE tenant_id=$1 AND item_id=$2 AND revision=$3 AND status<>'recovered' RETURNING id`,
            [item.tenant_id, item.id, item.revision],
          );
          if (recovered.rowCount)
            await queueNotification(tx, {
              tenantId: item.tenant_id,
              brandId: item.brand_id,
              eventKey: "recovered:" + item.id + ":" + item.revision,
              eventType: "recovered",
              message: "CF Studio • Produksi telah pulih. Buka Daily Review.",
            });
        });
      } catch (e) {
        if (e.code === "STALE_LEASE") throw e;
        await assertLease(run);
        if (e.code === "PIPELINE_PENDING") {
          await db.query(
            `UPDATE content_items SET status='queued' WHERE tenant_id=$1 AND id=$2`,
            [item.tenant_id, item.id],
          );
          continue;
        }
        if (e.code === "CREATIVE_REVIEW_REQUIRED") continue;
        await assertLease(run);
        await transaction(async (tx) => {
          const cause = e.code || "PIPELINE_FAILED";
          const retry =
            [
              "PROVIDER_RATE_LIMIT",
              "PROVIDER_UNAVAILABLE",
              "MEDIA_DOWNLOAD_FAILED",
            ].includes(cause) && item.retry_count < 3;
          const itemStatus = retry ? "retry_wait" : "failed";
          const next = retry
            ? new Date(Date.now() + [60000, 300000, 900000][item.retry_count])
            : null;
          await tx.query(
            `UPDATE content_items SET status=$4,error_code=$3,retry_count=retry_count+1,next_attempt_at=$5 WHERE tenant_id=$1 AND id=$2`,
            [item.tenant_id, item.id, cause, itemStatus, next],
          );
          await tx.query(
            `UPDATE stage_executions SET status='failed',error_code=$5 WHERE tenant_id=$1 AND item_id=$2 AND revision=$3 AND stage=$4`,
            [item.tenant_id, item.id, item.revision, stage, cause],
          );
          const event = {
            tenantId: item.tenant_id,
            brandName: run.config.brandSnapshot?.name || "Brand",
            runId: run.id,
            itemId: item.id,
            revision: item.revision,
            stage,
            causeGroup: cause,
            status: itemStatus,
          };
          const id = incidentKey(event);
          const previous = (
            await tx.query(
              "SELECT status FROM pipeline_incidents WHERE id=$1",
              [id],
            )
          ).rows[0];
          const inserted = await tx.query(
            `INSERT INTO pipeline_incidents(id,tenant_id,brand_id,run_id,item_id,revision,stage,cause_group,status,event) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$10,$9) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,event=EXCLUDED.event,updated_at=now() RETURNING id`,
            [
              id,
              item.tenant_id,
              item.brand_id,
              run.id,
              item.id,
              item.revision,
              stage,
              cause,
              event,
              itemStatus,
            ],
          );
          if (inserted.rowCount && previous?.status !== itemStatus)
            await queueNotification(tx, {
              tenantId: item.tenant_id,
              brandId: item.brand_id,
              eventKey:
                "batch-error:" +
                run.id +
                ":" +
                stage.split(":")[0] +
                ":" +
                cause +
                ":" +
                itemStatus,
              eventType: "error",
              message: safeIncidentMessage(event),
            });
        });
      }
    }
    await assertLease(run);
    const statuses = (
      await db.query(
        "SELECT status,count(*)::int AS count FROM content_items WHERE tenant_id=$1 AND run_id=$2 GROUP BY status",
        [run.tenant_id, run.id],
      )
    ).rows;
    const pending = statuses.some((s) =>
        ["queued", "retry_wait"].includes(s.status),
      ),
      review = statuses.some((s) => s.status === "awaiting_creative_approval"),
      failed = statuses.some((s) => s.status === "failed");
    const status = pending
      ? "queued"
      : review
        ? "awaiting_review"
        : failed
          ? "failed"
          : "completed";
    await transaction(async (tx) => {
      await tx.query(
        `UPDATE automation_runs SET status=$4,next_attempt_at=CASE WHEN $4='queued' THEN now()+interval '15 seconds' ELSE NULL END,completed_at=CASE WHEN $4='completed' THEN now() ELSE NULL END,lease_owner=NULL,lease_expires_at=NULL WHERE id=$1 AND lease_owner=$2 AND fencing_token=$3`,
        [run.id, workerId, run.fencing_token, status],
      );
      if (status === "failed" || status === "awaiting_review") {
        const ready = statuses.find((s) => s.status === "ready")?.count || 0;
        const failed = statuses.find((s) => s.status === "failed")?.count || 0;
        const creative =
          statuses.find((s) => s.status === "awaiting_creative_approval")
            ?.count || 0;
        await queueNotification(tx, {
          tenantId: run.tenant_id,
          brandId: run.config.brandId,
          eventKey: "run-summary:" + run.id + ":" + status,
          eventType: "ready",
          message: `CF Studio • Batch memerlukan review: ${ready} hasil siap, ${failed} perlu pemeriksaan, ${creative} menunggu persetujuan kreatif. Buka Daily Review.`,
        });
      }
      if (status === "completed")
        await queueNotification(tx, {
          tenantId: run.tenant_id,
          brandId: run.config.brandId,
          eventKey: "run-ready:" + run.id,
          eventType: "ready",
          message:
            "CF Studio • Batch harian siap direview. Persetujuan final Anda diperlukan sebelum dijadwalkan.",
        });
    });
    return true;
  } finally {
    clearInterval(heartbeat);
  }
}
