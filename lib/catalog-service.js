import { randomUUID } from "node:crypto";
import { getPool, transaction } from "./db-pg.js";
import { assertAccess } from "./access-control.js";
import { StudioError } from "./errors.js";
import { audit } from "./idempotency.js";
function rejectSecrets(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, v] of Object.entries(value)) {
    if (
      /(password|secret|api[_-]?key|access[_-]?token|bot[_-]?token|authorization|cookie)$/i.test(
        key,
      )
    )
      throw new StudioError(
        "CATALOG_SECRET_DENIED",
        "Credential hanya boleh disimpan melalui Settings.",
      );
    rejectSecrets(v);
  }
}
const domains = [
  "product",
  "deconstruct",
  "brand",
  "visual_identity",
  "preset",
];
export async function requireCatalog(
  db,
  actor,
  id,
  capability = "catalog.read",
) {
  const item = (
    await db.query(
      "SELECT * FROM catalog_items WHERE tenant_id=$1 AND id=$2 AND archived=false",
      [actor.tenantId, id],
    )
  ).rows[0];
  if (!item) throw new StudioError("NOT_FOUND", "Objek tidak ditemukan.", 404);
  assertAccess(
    actor,
    {
      tenantId: item.tenant_id,
      brandId: item.domain === "brand" ? item.id : item.brand_id,
    },
    capability,
  );
  if (
    !actor.allBrands &&
    !item.brand_id &&
    ["product", "deconstruct"].includes(item.domain)
  ) {
    const linked =
      item.domain === "product"
        ? await db.query(
            `SELECT 1 FROM catalog_items WHERE tenant_id=$1 AND domain='binding' AND payload->>'productId'=$2 AND payload->>'brandId'=ANY($3::text[]) AND COALESCE((payload->>'active')::boolean,true)=true`,
            [actor.tenantId, item.id, actor.brandIds],
          )
        : { rowCount: 0 };
    if (!linked.rowCount)
      throw new StudioError("NOT_FOUND", "Objek tidak ditemukan.", 404);
  }
  return item;
}
export async function listCatalog(actor, domain) {
  if (!domains.includes(domain))
    throw new StudioError("DOMAIN_INVALID", "Domain tidak valid.");
  assertAccess(actor, { tenantId: actor.tenantId }, "catalog.read");
  return (
    await getPool().query(
      `SELECT c.id,c.domain,c.brand_id,c.name,c.revision,c.archived,c.payload,COALESCE((SELECT jsonb_agg(b.payload->>'brandId') FROM catalog_items b WHERE b.tenant_id=c.tenant_id AND b.domain='binding' AND b.archived=false AND b.payload->>'productId'=c.id AND COALESCE((b.payload->>'active')::boolean,true)=true),'[]') AS linked_brand_ids FROM catalog_items c WHERE tenant_id=$1 AND domain=$2 AND archived=false AND ($3::boolean OR brand_id=ANY($4::text[]) OR (domain='brand' AND id=ANY($4::text[])) OR (brand_id IS NULL AND domain IN('preset','visual_identity')) OR (domain='product' AND EXISTS(SELECT 1 FROM catalog_items b WHERE b.tenant_id=c.tenant_id AND b.domain='binding' AND b.archived=false AND b.payload->>'productId'=c.id AND b.payload->>'brandId'=ANY($4::text[]) AND COALESCE((b.payload->>'active')::boolean,true)=true))) ORDER BY name`,
      [actor.tenantId, domain, actor.allBrands, actor.brandIds],
    )
  ).rows;
}
export async function saveCatalog(actor, input) {
  rejectSecrets(input.payload);
  if (!domains.includes(input.domain) || !input.name?.trim())
    throw new StudioError("CATALOG_INVALID", "Domain dan nama wajib.");
  assertAccess(
    actor,
    {
      tenantId: actor.tenantId,
      brandId: input.domain === "brand" ? input.id : input.brandId,
    },
    "catalog.manage",
  );
  return transaction(async (db) => {
    if (input.brandId) {
      const brand = await requireCatalog(
        db,
        actor,
        input.brandId,
        "catalog.manage",
      );
      if (brand.domain !== "brand")
        throw new StudioError("BRAND_INVALID", "Bukan brand.");
    }
    let row;
    if (input.id) {
      const current = await requireCatalog(
        db,
        actor,
        input.id,
        "catalog.manage",
      );
      if (
        current.domain !== input.domain ||
        current.revision !== input.expectedRevision
      )
        throw new StudioError("STALE_REVISION", "Versi berubah.", 409);
      if (current.payload?.is_system)
        throw new StudioError(
          "SYSTEM_READ_ONLY",
          "Preset sistem hanya baca.",
          403,
        );
      row = (
        await db.query(
          "UPDATE catalog_items SET name=$1,payload=$2,brand_id=$5,revision=revision+1,updated_at=now() WHERE tenant_id=$3 AND id=$4 AND revision=$6 RETURNING *",
          [
            input.name.trim(),
            input.payload || {},
            actor.tenantId,
            input.id,
            input.brandId || current.brand_id || null,
            current.revision,
          ],
        )
      ).rows[0];
    } else {
      if (input.domain === "brand" && !actor.allBrands)
        throw new StudioError(
          "BRAND_CREATE_DENIED",
          "Pembuatan brand memerlukan pengelola seluruh brand.",
          403,
        );
      row = (
        await db.query(
          "INSERT INTO catalog_items(id,tenant_id,domain,brand_id,name,payload) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [
            randomUUID(),
            actor.tenantId,
            input.domain,
            input.brandId || null,
            input.name.trim(),
            input.payload || {},
          ],
        )
      ).rows[0];
    }
    if (!row)
      throw new StudioError(
        "STALE_REVISION",
        "Versi berubah. Muat ulang.",
        409,
      );
    await audit(
      db,
      actor,
      "catalog.saved",
      { id: row.id, revision: row.revision, domain: row.domain },
      row.brand_id || (row.domain === "brand" ? row.id : null),
    );
    return row;
  });
}
export async function archiveCatalog(actor, id, expectedRevision) {
  return transaction(async (db) => {
    const item = await requireCatalog(db, actor, id, "catalog.manage");
    if (item.revision !== expectedRevision)
      throw new StudioError("STALE_REVISION", "Versi berubah.", 409);
    if (item.payload?.is_system)
      throw new StudioError(
        "SYSTEM_READ_ONLY",
        "Preset sistem hanya baca.",
        403,
      );
    const archived = await db.query(
      "UPDATE catalog_items SET archived=true,revision=revision+1 WHERE tenant_id=$1 AND id=$2 AND revision=$3",
      [actor.tenantId, id, expectedRevision],
    );
    if (!archived.rowCount)
      throw new StudioError("STALE_REVISION", "Versi berubah.", 409);
    await audit(db, actor, "catalog.archived", { id }, item.brand_id);
    return { archived: true };
  });
}
export async function listAssignments(actor, brandId) {
  const db = getPool();
  const brand = await requireCatalog(db, actor, brandId);
  if (brand.domain !== "brand")
    throw new StudioError("BRAND_INVALID", "Bukan brand.");
  return (
    await db.query(
      "SELECT a.*,c.name,c.payload,c.origin_key FROM brand_assignments a JOIN catalog_items c ON c.tenant_id=a.tenant_id AND c.id=a.object_id WHERE a.tenant_id=$1 AND a.brand_id=$2 AND c.archived=false ORDER BY c.name",
      [actor.tenantId, brandId],
    )
  ).rows;
}
export async function assignExisting(actor, brandId, input) {
  return transaction(async (db) => {
    await requireCatalog(db, actor, brandId, "catalog.manage");
    const item = await requireCatalog(db, actor, input.objectId);
    if (!["preset", "visual_identity"].includes(item.domain))
      throw new StudioError(
        "ASSIGNMENT_INVALID",
        "Objek bukan preset/identity.",
      );
    if (item.brand_id && item.brand_id !== brandId)
      throw new StudioError(
        "BRAND_ACCESS_DENIED",
        "Objek khusus brand lain.",
        403,
      );
    const row = (
      await db.query(
        "INSERT INTO brand_assignments(tenant_id,brand_id,object_id,kind,object_revision) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,brand_id,object_id) DO UPDATE SET active=true,object_revision=EXCLUDED.object_revision,revision=brand_assignments.revision+1 RETURNING *",
        [actor.tenantId, brandId, item.id, item.domain, item.revision],
      )
    ).rows[0];
    await audit(
      db,
      actor,
      "brand.assigned",
      { objectId: item.id, kind: item.domain },
      brandId,
    );
    return row;
  });
}
