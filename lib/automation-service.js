import { nextRunAt } from "./schedule.js";
import { randomUUID } from "node:crypto";
import { getPool, transaction } from "./db-pg.js";
import { assertAccess } from "./access-control.js";
import { validateRoutine } from "./automation-contract.js";
import { StudioError } from "./errors.js";
import { requireCatalog } from "./catalog-service.js";
import { once, audit } from "./idempotency.js";
export async function snapshotConfig(db, actor, input) {
  const config = validateRoutine(input);
  const brand = await requireCatalog(db, actor, config.brandId);
  if (brand.domain !== "brand")
    throw new StudioError("BRAND_INVALID", "Brand tidak tersedia.");
  const targets = [];
  for (const target of config.targets) {
    if (target.selected === false) continue;
    const snapshot = { ...target };
    for (const field of [
      "presetSnapshot",
      "identitySnapshot",
      "productSnapshot",
      "sourceSnapshot",
    ])
      delete snapshot[field];
    if (target.kind === "product_campaign") {
      const p = await requireCatalog(db, actor, target.productId);
      if (p.domain !== "product")
        throw new StudioError("PRODUCT_INVALID", "Produk tidak tersedia.");
      const binding = await db.query(
        `SELECT 1 FROM catalog_items WHERE tenant_id=$1 AND domain='binding' AND archived=false AND payload->>'productId'=$2 AND payload->>'brandId'=$3 AND COALESCE((payload->>'active')::boolean,true)=true`,
        [actor.tenantId, p.id, brand.id],
      );
      if (p.brand_id !== brand.id && !binding.rowCount)
        throw new StudioError("PRODUCT_INVALID", "Produk belum terkait brand.");
      snapshot.productSnapshot = p;
    }
    if (target.kind === "multiplier") {
      const source = await requireCatalog(db, actor, target.sourceId);
      if (
        source.domain !== "deconstruct" ||
        source.payload.status !== "deconstructed"
      )
        throw new StudioError(
          "SOURCE_NOT_READY",
          "Hasil deconstruct belum siap.",
        );
      snapshot.sourceSnapshot = source;
    }
    if (target.presetId) {
      const p = await requireCatalog(db, actor, target.presetId);
      if (p.domain !== "preset" || (p.brand_id && p.brand_id !== brand.id))
        throw new StudioError(
          "PRESET_INVALID",
          "Preset tidak tersedia pada brand ini.",
        );
      const assigned = await db.query(
        "SELECT 1 FROM brand_assignments WHERE tenant_id=$1 AND brand_id=$2 AND object_id=$3 AND active=true",
        [actor.tenantId, brand.id, p.id],
      );
      if (!assigned.rowCount)
        throw new StudioError(
          "PRESET_NOT_ASSIGNED",
          "Pilih preset yang terkait brand.",
        );
      snapshot.presetSnapshot = p;
    }
    if (target.identityId) {
      const v = await requireCatalog(db, actor, target.identityId);
      const a = await db.query(
        "SELECT 1 FROM brand_assignments WHERE tenant_id=$1 AND brand_id=$2 AND object_id=$3 AND active=true",
        [actor.tenantId, brand.id, v.id],
      );
      if (v.domain !== "visual_identity" || !a.rowCount)
        throw new StudioError(
          "IDENTITY_NOT_ASSIGNED",
          "Visual identity belum terkait brand.",
        );
      snapshot.identitySnapshot = v;
    }
    targets.push(snapshot);
  }
  return {
    ...config,
    targets,
    brandSnapshot: brand,
    creativeApproval: config.creativeApproval || "auto",
  };
}
export async function saveRoutine(actor, input) {
  const config = validateRoutine(input);
  assertAccess(
    actor,
    { tenantId: actor.tenantId, brandId: input.brandId },
    "automation.manage",
  );
  return transaction(async (db) => {
    await snapshotConfig(db, actor, config);
    let row;
    if (input.id) {
      row = (
        await db.query(
          "UPDATE routines SET draft=$1,revision=revision+1,updated_at=now() WHERE tenant_id=$2 AND id=$3 AND revision=$4 AND brand_id=$5 RETURNING *",
          [
            config,
            actor.tenantId,
            input.id,
            input.expectedRevision ?? input.revision,
            input.brandId,
          ],
        )
      ).rows[0];
      if (!row)
        throw new StudioError(
          "STALE_REVISION",
          "Rutinitas berubah. Muat ulang.",
          409,
        );
    } else
      row = (
        await db.query(
          "INSERT INTO routines(id,tenant_id,brand_id,draft,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [randomUUID(), actor.tenantId, input.brandId, config, actor.id],
        )
      ).rows[0];
    await audit(
      db,
      actor,
      "routine.draft_saved",
      { id: row.id, revision: row.revision },
      row.brand_id,
    );
    return row;
  });
}
export async function requireRoutine(db, actor, id, cap = "automation.read") {
  const row = (
    await db.query(
      "SELECT * FROM routines WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [actor.tenantId, id],
    )
  ).rows[0];
  if (!row)
    throw new StudioError("NOT_FOUND", "Rutinitas tidak ditemukan.", 404);
  assertAccess(actor, { tenantId: row.tenant_id, brandId: row.brand_id }, cap);
  return row;
}
export async function activateRoutine(actor, id, revision) {
  return transaction(async (db) => {
    const row = await requireRoutine(db, actor, id, "automation.manage");
    assertAccess(
      actor,
      { tenantId: row.tenant_id, brandId: row.brand_id },
      "production.run",
    );
    if (row.revision !== revision)
      throw new StudioError("STALE_REVISION", "Versi berubah.", 409);
    const config = await snapshotConfig(db, actor, row.draft);
    if (
      config.creativeApproval === "auto" &&
      config.targets.some((t) => !t.presetSnapshot)
    )
      throw new StudioError(
        "PRESET_REQUIRED",
        "Pilih preset untuk setiap target sebelum aktivasi otomatis.",
      );
    const saved = (
      await db.query(
        `UPDATE routines SET active_revision=revision,active_config=$3,state='active',next_run_at=$4,created_by=$5 WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [actor.tenantId, id, config, nextRunAt(config), actor.id],
      )
    ).rows[0];
    await audit(db, actor, "routine.activated", { id, revision }, row.brand_id);
    return saved;
  });
}
export async function routineState(actor, id, revision, action) {
  return transaction(async (db) => {
    const row = await requireRoutine(db, actor, id, "automation.manage");
    if (row.revision !== revision)
      throw new StudioError("STALE_REVISION", "Versi berubah.", 409);
    const status = { pause: "paused", resume: "active", archive: "archived" }[
      action
    ];
    if (!status || (action === "resume" && !row.active_config))
      throw new StudioError("STATE_INVALID", "Revisi aktif belum tersedia.");
    if (action === "resume")
      assertAccess(
        actor,
        { tenantId: row.tenant_id, brandId: row.brand_id },
        "production.run",
      );
    const result = (
      await db.query(
        "UPDATE routines SET state=$3,next_run_at=$4 WHERE tenant_id=$1 AND id=$2 RETURNING *",
        [
          actor.tenantId,
          id,
          status,
          status === "active" ? nextRunAt(row.active_config) : null,
        ],
      )
    ).rows[0];
    await audit(db, actor, "routine." + action, { id }, row.brand_id);
    return result;
  });
}
export async function createRun(
  db,
  actor,
  routine,
  config,
  { mode = "run_once", slot = null } = {},
) {
  const runId = randomUUID();
  const run = (
    await db.query(
      "INSERT INTO automation_runs(id,tenant_id,routine_id,scheduled_slot,execution_mode,config,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING *",
      [
        runId,
        actor.tenantId,
        routine.id,
        slot,
        mode,
        {
          ...config,
          routineRevision:
            mode === "scheduled"
              ? routine.active_revision
              : config.routineRevision,
        },
        actor.id,
      ],
    )
  ).rows[0];
  if (!run) return null;
  for (const target of config.targets.filter((t) => t.selected !== false))
    for (let n = 0; n < target.count; n++)
      await db.query(
        "INSERT INTO content_items(id,tenant_id,run_id,brand_id,created_by,source_kind,target_config) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          randomUUID(),
          actor.tenantId,
          run.id,
          routine.brand_id,
          actor.id,
          target.kind,
          { ...target, variation: n + 1 },
        ],
      );
  await audit(
    db,
    actor,
    "run.created",
    { runId: run.id, mode, slot },
    routine.brand_id,
  );
  return run;
}
export async function runOnce(actor, id, input, key) {
  return transaction(async (db) => {
    const routine = await requireRoutine(db, actor, id, "production.run");
    return once(
      db,
      {
        tenantId: actor.tenantId,
        operation: "run_once:" + id,
        key,
        payload: input,
      },
      async () => {
        const useActive = input.source === "active";
        if (useActive && !routine.active_config)
          throw new StudioError("ACTIVE_REQUIRED", "Revisi aktif belum ada.");
        const revision = useActive ? routine.active_revision : routine.revision;
        if (input.expectedRevision !== revision)
          throw new StudioError(
            "STALE_REVISION",
            "Revisi pilihan berubah.",
            409,
          );
        const config = useActive
          ? structuredClone(routine.active_config)
          : await snapshotConfig(db, actor, routine.draft);
        return createRun(db, actor, routine, {
          ...config,
          routineRevision: revision,
        });
      },
    );
  });
}
export async function listRoutines(actor) {
  assertAccess(actor, { tenantId: actor.tenantId }, "automation.read");
  return (
    await getPool().query(
      "SELECT * FROM routines WHERE tenant_id=$1 AND ($2::boolean OR brand_id=ANY($3::text[])) ORDER BY updated_at DESC",
      [actor.tenantId, actor.allBrands, actor.brandIds],
    )
  ).rows;
}
