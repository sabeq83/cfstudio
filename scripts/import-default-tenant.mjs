import pg from "pg";
import { readFile } from "node:fs/promises";
import { domainTables, importSnapshot } from "../lib/import-service.js";
import { assertSeparateDatabases } from "../lib/runtime-config.js";
import { getPool, transaction } from "../lib/db-pg.js";
import { randomUUID } from "node:crypto";
if (
  !process.env.SOURCE_DATABASE_URL ||
  !process.env.SOURCE_TENANT_ID ||
  !process.env.TARGET_TENANT_ID
)
  throw new Error("Konfigurasi sumber/tenant wajib eksplisit.");
if (process.env.SOURCE_SCHEMA !== "staging")
  throw new Error("SOURCE_SCHEMA harus staging.");
if (!process.env.DATABASE_URL)
  throw new Error("Database tujuan wajib untuk verifikasi isolasi.");
assertSeparateDatabases(
  process.env.SOURCE_DATABASE_URL,
  process.env.DATABASE_URL,
);
const apply = process.argv.includes("--apply");
const source = new pg.Client({
  connectionString: process.env.SOURCE_DATABASE_URL,
});
try {
  await source.connect();
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const exists = await source.query(
    "SELECT id FROM staging.tenants WHERE id=$1",
    [process.env.SOURCE_TENANT_ID],
  );
  if (!exists.rowCount) throw new Error("SOURCE_TENANT_INVALID");
  const snapshot = {};
  for (const [domain, table] of Object.entries(domainTables))
    snapshot[domain] = (
      await source.query(
        `SELECT * FROM staging."${table}" WHERE tenant_id=$1`,
        [process.env.SOURCE_TENANT_ID],
      )
    ).rows;
  const row = (
    await source.query(
      `SELECT setting_value FROM staging.tenant_settings WHERE tenant_id=$1 AND setting_key='operator_presets_json'`,
      [process.env.SOURCE_TENANT_ID],
    )
  ).rows[0];
  const presets = JSON.parse(row?.setting_value || "{}");
  snapshot.preset = Object.entries(presets).map(([key, value]) => ({
    id: key,
    tenant_id: process.env.SOURCE_TENANT_ID,
    preset_key: key,
    label: value.label || key,
    config_json: value,
  }));
  await source.query("ROLLBACK");
  const system = JSON.parse(
    await readFile(
      new URL("../lib/legacy/system-presets.json", import.meta.url),
      "utf8",
    ),
  );
  for (const p of system.operator)
    snapshot.preset.push({
      id: "system:" + p.key,
      tenant_id: process.env.SOURCE_TENANT_ID,
      preset_key: p.key,
      label: p.config.label || p.key,
      config_json: p.config,
      is_system: true,
    });
  for (const p of system.identity)
    if (!snapshot.visual_identity.some((x) => x.preset_key === p.key))
      snapshot.visual_identity.push({
        id: "system:" + p.key,
        tenant_id: process.env.SOURCE_TENANT_ID,
        preset_key: p.key,
        label: p.label,
        config_json: p.config,
        version: p.version,
        is_system: true,
      });
  for (const p of system.universe)
    snapshot.dependency.push({
      id: "universe:" + p.key,
      tenant_id: process.env.SOURCE_TENANT_ID,
      label: p.label,
      config_json: p,
      is_system: true,
    });
  const counts = Object.fromEntries(
    Object.entries(snapshot).map(([k, v]) => [k, v.length]),
  );
  if (!apply) {
    console.log(JSON.stringify({ dryRun: true, counts, mediaVerified: false }));
  } else {
    const result = await transaction((db) =>
      importSnapshot(db, snapshot, {
        batchId: randomUUID(),
        sourceTenantId: process.env.SOURCE_TENANT_ID,
        targetTenantId: process.env.TARGET_TENANT_ID,
      }),
    );
    console.log(
      JSON.stringify({
        ...result,
        mediaStatus: "unverified; separate asset reconciliation required",
      }),
    );
  }
} finally {
  await source.end();
  await getPool().end();
}
