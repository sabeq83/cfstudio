import { createHash } from "node:crypto";
import { invariant } from "./errors.js";
export const domainTables = {
  product: "product_extractions",
  deconstruct: "re_deconstructed_assets",
  brand: "brand_profiles",
  visual_identity: "visual_identity_presets",
  binding: "brand_products",
  dependency: "re_deconstruct_batches",
};
export function originKey({ system, tenantId, domain, id }) {
  invariant(
    system && tenantId && domain && id !== undefined,
    "ORIGIN_REQUIRED",
    "Identitas sumber wajib",
  );
  return JSON.stringify([system, tenantId, domain, String(id)]);
}
export function mappedId(source) {
  return (
    "import_" +
    createHash("sha256").update(originKey(source)).digest("hex").slice(0, 28)
  );
}
export function cleanImportPayload(value) {
  if (Array.isArray(value)) return value.map(cleanImportPayload);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k]) =>
            !/(password|secret|token|api.?key|session|gemini_file_uri)/i.test(
              k,
            ),
        )
        .map(([k, v]) => [k, cleanImportPayload(v)]),
    );
  if (typeof value === "string" && value.trim().startsWith("{")) {
    try {
      return JSON.stringify(cleanImportPayload(JSON.parse(value)));
    } catch {}
  }
  return value;
}
export function planObject(
  record,
  { domain, sourceTenantId, targetTenantId, system = "maknaflow-staging" },
) {
  invariant(
    record.tenant_id === sourceTenantId,
    "SOURCE_TENANT_MISMATCH",
    "Objek bukan milik tenant sumber.",
  );
  const origin = { system, tenantId: sourceTenantId, domain, id: record.id };
  const payload = cleanImportPayload(record);
  delete payload.tenant_id;
  return {
    id: mappedId(origin),
    tenantId: targetTenantId,
    domain,
    name:
      record.product_name ||
      record.brand_name ||
      record.label ||
      record.batch_name ||
      `Sumber ${record.id}`,
    originKey: originKey(origin),
    payload,
    usable: false,
    mediaStatus: "not_verified",
  };
}
export function resolveImportConflict(
  previous,
  sourceHash,
  destinationRevision,
) {
  if (!previous) return "insert";
  if (previous.destinationRevision !== destinationRevision) return "conflict";
  return previous.sourceHash === sourceHash ? "reuse" : "update";
}

export async function importSnapshot(db, snapshot, options) {
  const { fingerprint } = await import("./production-package.js");
  const batchId = options.batchId || "import_" + Date.now();
  const system = options.system || "maknaflow-staging";
  const sourceTenantId = options.sourceTenantId;
  const targetTenantId = options.targetTenantId;
  invariant(
    sourceTenantId && targetTenantId,
    "TENANT_REQUIRED",
    "Tenant sumber dan tujuan wajib.",
  );
  await db.query(
    "INSERT INTO import_batches(id,tenant_id,source_system,source_tenant_id) VALUES($1,$2,$3,$4)",
    [batchId, targetTenantId, system, sourceTenantId],
  );
  const rows = [];
  for (const [domain, records] of Object.entries(snapshot))
    for (const record of records)
      rows.push({
        domain,
        record,
        plan: planObject(record, {
          domain,
          sourceTenantId,
          targetTenantId,
          system,
        }),
      });
  const mapping = new Map();
  for (const x of rows) {
    mapping.set(x.domain + ":" + x.record.id, x.plan.id);
    if (x.record.preset_key)
      mapping.set(x.domain + ":" + x.record.preset_key, x.plan.id);
  }
  function remap(value, key = "") {
    if (Array.isArray(value)) return value.map((x) => remap(x, key));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, remap(v, k)]),
      );
    if (
      typeof value === "string" &&
      (key.endsWith("_json") || key === "config_json")
    ) {
      try {
        return JSON.stringify(remap(JSON.parse(value)));
      } catch {}
    }
    const domain = /visual_identity_preset_id/.test(key)
      ? "visual_identity"
      : /brand_profile_id|brand_id/.test(key)
        ? "brand"
        : key === "product_id"
          ? "product"
          : null;
    return domain ? mapping.get(domain + ":" + value) || value : value;
  }
  const summary = {
    batchId,
    inserted: 0,
    updated: 0,
    reused: 0,
    conflicts: [],
    unresolvedBindings: 0,
    mediaUnverified: 0,
  };
  for (const x of rows) {
    const plan = x.plan;
    plan.payload = remap(plan.payload);
    if (x.domain === "binding") {
      const brandId = mapping.get("brand:" + x.record.brand_profile_id),
        productId = mapping.get("product:" + x.record.product_id);
      if (!brandId || !productId) {
        summary.unresolvedBindings++;
        continue;
      }
      plan.payload = {
        ...plan.payload,
        brandId,
        productId,
        active: x.record.is_active,
      };
      plan.brandId = brandId;
    }
    plan.name =
      x.record.product_name ||
      x.record.brand_name ||
      x.record.label ||
      x.record.config_json?.label ||
      x.record.original_caption?.slice(0, 80) ||
      x.record.batch_name ||
      String(x.record.id);
    plan.payload.migration = {
      mediaStatus: "unverified",
      sourceState: x.record.status || x.record.extraction_status || null,
      sourceSystem: system,
    };
    summary.mediaUnverified++;
    const hash = fingerprint(plan.payload);
    const prev = (
      await db.query(
        "SELECT o.*,c.revision AS current_revision FROM import_origins o JOIN catalog_items c ON c.tenant_id=o.tenant_id AND c.id=o.target_id WHERE o.tenant_id=$1 AND o.source_system=$2 AND o.source_tenant_id=$3 AND o.domain=$4 AND o.source_id=$5",
        [targetTenantId, system, sourceTenantId, x.domain, String(x.record.id)],
      )
    ).rows[0];
    const action = resolveImportConflict(
      prev
        ? {
            sourceHash: prev.source_hash,
            destinationRevision: prev.destination_revision,
          }
        : null,
      hash,
      prev?.current_revision,
    );
    if (action === "conflict") {
      summary.conflicts.push({
        domain: x.domain,
        sourceId: String(x.record.id),
        reason: "DESTINATION_EDITED",
      });
      continue;
    }
    if (action === "reuse") {
      summary.reused++;
      continue;
    }
    if (action === "insert")
      await db.query(
        "INSERT INTO catalog_items(id,tenant_id,domain,brand_id,name,payload,origin_key) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          plan.id,
          targetTenantId,
          x.domain,
          plan.brandId || null,
          plan.name,
          plan.payload,
          plan.originKey,
        ],
      );
    else
      await db.query(
        "UPDATE catalog_items SET name=$3,payload=$4,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [targetTenantId, plan.id, plan.name, plan.payload],
      );
    const revision = (
      await db.query(
        "SELECT revision FROM catalog_items WHERE tenant_id=$1 AND id=$2",
        [targetTenantId, plan.id],
      )
    ).rows[0].revision;
    await db.query(
      "INSERT INTO import_origins(tenant_id,source_system,source_tenant_id,domain,source_id,target_id,source_hash,destination_revision,batch_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,source_system,source_tenant_id,domain,source_id) DO UPDATE SET source_hash=EXCLUDED.source_hash,destination_revision=EXCLUDED.destination_revision,batch_id=EXCLUDED.batch_id",
      [
        targetTenantId,
        system,
        sourceTenantId,
        x.domain,
        String(x.record.id),
        plan.id,
        hash,
        revision,
        batchId,
      ],
    );
    summary[action === "insert" ? "inserted" : "updated"]++;
  }
  await db.query("UPDATE import_batches SET manifest=$2 WHERE id=$1", [
    batchId,
    summary,
  ]);
  return summary;
}
