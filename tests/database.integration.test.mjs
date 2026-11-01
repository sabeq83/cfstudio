import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { setTestDatabase, transaction } from "../lib/db-pg.js";
import {
  saveCatalog,
  listCatalog,
  assignExisting,
  listAssignments,
} from "../lib/catalog-service.js";
import {
  saveRoutine,
  activateRoutine,
  runOnce,
} from "../lib/automation-service.js";
import { approveFinal, editContent } from "../lib/review-service.js";
import { importSnapshot } from "../lib/import-service.js";
let pg, brand, routine;
const caps = [
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
];
const actor = {
  id: "user-a",
  tenantId: "tenant-a",
  status: "active",
  tenantStatus: "active",
  allBrands: true,
  brandIds: [],
  capabilities: caps,
};
const other = { ...actor, id: "user-b", tenantId: "tenant-b" };
before(async () => {
  process.env.NODE_ENV = "test";
  pg = new PGlite();
  for (const name of (
    await readdir(new URL("../db/migrations/", import.meta.url))
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
  await pg.exec(
    "INSERT INTO tenants(id,name) VALUES('tenant-a','A'),('tenant-b','B'); INSERT INTO users(id,tenant_id,username,password_hash) VALUES('user-a','tenant-a','a','TEST_MOCK_HASH'),('user-b','tenant-b','b','TEST_MOCK_HASH')",
  );
});
after(async () => {
  setTestDatabase(null);
  await pg.close();
});
test("migrasi PostgreSQL berhasil dan katalog terisolasi per tenant", async () => {
  brand = await saveCatalog(actor, {
    domain: "brand",
    name: "Brand A",
    payload: {},
  });
  const rows = await listCatalog(actor, "brand");
  assert.equal(rows.length, 1);
  assert.equal((await listCatalog(other, "brand")).length, 0);
});
test("assignment existing preset tidak menggandakan katalog", async () => {
  const preset = await saveCatalog(actor, {
    domain: "preset",
    name: "Preset impor contoh",
    payload: {},
  });
  await assignExisting(actor, brand.id, { objectId: preset.id });
  await assignExisting(actor, brand.id, { objectId: preset.id });
  assert.equal((await listAssignments(actor, brand.id)).length, 1);
  assert.equal((await listCatalog(actor, "preset")).length, 1);
  await assert.rejects(
    () => assignExisting(other, brand.id, { objectId: preset.id }),
    { code: "NOT_FOUND" },
  );
});
test("save draft r2 tidak mengubah active r1 dan stale update ditolak", async () => {
  const input = {
    name: "Routine A",
    brandId: brand.id,
    time: "05:00",
    frequency: "daily",
    timezone: "Asia/Jakarta",
    creativeApproval: "manual",
    targets: [
      { name: "Editorial", kind: "brand_editorial", count: 1, selected: true },
    ],
  };
  routine = await saveRoutine(actor, input);
  await activateRoutine(actor, routine.id, 1);
  const edited = await saveRoutine(actor, {
    ...input,
    name: "Draf baru",
    id: routine.id,
    expectedRevision: 1,
  });
  const row = (
    await pg.query("SELECT * FROM routines WHERE tenant_id=$1 AND id=$2", [
      actor.tenantId,
      routine.id,
    ])
  ).rows[0];
  assert.equal(row.active_revision, 1);
  assert.equal(row.active_config.name, "Routine A");
  assert.equal(edited.revision, 2);
  await assert.rejects(
    () => saveRoutine(actor, { ...input, id: routine.id, expectedRevision: 1 }),
    { code: "STALE_REVISION" },
  );
});
test("run sekali idempotent, beda payload key sama ditolak dan slot tidak bergeser", async () => {
  const before = (
    await pg.query("SELECT next_run_at FROM routines WHERE id=$1", [routine.id])
  ).rows[0];
  const input = { source: "active", expectedRevision: 1 };
  const a = await runOnce(actor, routine.id, input, "run-key-1"),
    b = await runOnce(actor, routine.id, input, "run-key-1");
  assert.equal(a.id, b.id);
  const after = (
    await pg.query("SELECT next_run_at FROM routines WHERE id=$1", [routine.id])
  ).rows[0];
  assert.equal(String(before.next_run_at), String(after.next_run_at));
  await assert.rejects(
    () =>
      runOnce(
        actor,
        routine.id,
        { source: "draft", expectedRevision: 2 },
        "run-key-1",
      ),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
});
test("self approval memerlukan dua capability dan edit menginvalidasi versi", async () => {
  const item = (
    await pg.query("SELECT * FROM content_items WHERE tenant_id=$1", [
      actor.tenantId,
    ])
  ).rows[0];
  await pg.query(
    "UPDATE content_items SET status='ready',caption='Before',artifacts='{}' WHERE tenant_id=$1 AND id=$2",
    [actor.tenantId, item.id],
  );
  const reviewer = { ...actor, capabilities: ["content.approve"] };
  await assert.rejects(() => approveFinal(reviewer, item.id, 1), {
    code: "CAPABILITY_REQUIRED",
  });
  await approveFinal(actor, item.id, 1);
  const changed = await editContent(actor, item.id, {
    expectedRevision: 1,
    caption: "After",
  });
  assert.equal(changed.revision, 2);
  await assert.rejects(() => approveFinal(actor, item.id, 1), {
    code: "STALE_REVISION",
  });
  const old = (
    await pg.query(
      "SELECT count(*)::int AS n FROM approvals WHERE tenant_id=$1 AND item_id=$2 AND revision=2",
      [actor.tenantId, item.id],
    )
  ).rows[0];
  assert.equal(old.n, 0);
});
test("import ulang reuse, preset ikut terimpor dan edit tujuan tidak ditimpa", async () => {
  const snapshot = {
    brand: [
      {
        id: "legacy-b",
        tenant_id: "default_tenant",
        brand_name: "Imported B",
        webhook_api_key: "TEST_MOCK_API_KEY",
      },
    ],
    preset: [
      {
        id: "legacy-p",
        tenant_id: "default_tenant",
        label: "Imported P",
        config_json: {
          voice_speed: 0.9,
          visual_overrides_json: { lighting: "window" },
        },
      },
    ],
  };
  const options = {
    sourceTenantId: "default_tenant",
    targetTenantId: actor.tenantId,
  };
  const first = await transaction((db) =>
    importSnapshot(db, snapshot, { ...options, batchId: "batch1" }),
  );
  assert.equal(first.inserted, 2);
  const second = await transaction((db) =>
    importSnapshot(db, snapshot, { ...options, batchId: "batch2" }),
  );
  assert.equal(second.reused, 2);
  const target = (
    await pg.query(
      "SELECT * FROM catalog_items WHERE tenant_id=$1 AND name='Imported P'",
      [actor.tenantId],
    )
  ).rows[0];
  await saveCatalog(actor, {
    id: target.id,
    expectedRevision: target.revision,
    domain: "preset",
    name: target.name,
    payload: { voice_speed: 1.1 },
  });
  const third = await transaction((db) =>
    importSnapshot(db, snapshot, { ...options, batchId: "batch3" }),
  );
  assert.equal(third.conflicts.length, 1);
  assert.equal(
    (
      await pg.query(
        "SELECT payload FROM catalog_items WHERE tenant_id=$1 AND id=$2",
        [actor.tenantId, target.id],
      )
    ).rows[0].payload.voice_speed,
    1.1,
  );
});
test("foreign key approval melarang aktor tenant lain walau ID valid", async () => {
  const item = (
    await pg.query("SELECT id FROM content_items WHERE tenant_id=$1 LIMIT 1", [
      actor.tenantId,
    ])
  ).rows[0];
  await assert.rejects(() =>
    pg.query(
      "INSERT INTO approvals(tenant_id,item_id,revision,actor_id) VALUES($1,$2,99,$3)",
      [actor.tenantId, item.id, other.id],
    ),
  );
});
