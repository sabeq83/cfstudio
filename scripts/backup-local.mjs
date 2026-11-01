import pg from "pg";
import path from "node:path";
import { mkdir, chmod } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const app = new URL(process.env.DATABASE_URL),
  admin = new URL(process.env.CF_LOCAL_ADMIN_DATABASE_URL);
if (
  app.hostname !== "127.0.0.1" ||
  app.port !== "55432" ||
  app.pathname !== "/cfstudio_dev" ||
  admin.hostname !== app.hostname ||
  admin.port !== app.port
)
  throw new Error("LOCAL_CF_DATABASE_REQUIRED");
const root = path.resolve("runtime/backups");
await mkdir(root, { recursive: true, mode: 0o700 });
const file = path.join(
  root,
  "cfstudio-" + new Date().toISOString().replaceAll(":", "-") + ".dump",
);
const bin = "/opt/homebrew/opt/postgresql@17/bin/";
const environment = (url) => ({
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port,
  PGDATABASE: url.pathname.slice(1),
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
});
execFileSync(
  bin + "pg_dump",
  ["-Fc", "--no-owner", "--no-acl", "--file", file],
  { env: environment(app), stdio: ["ignore", "ignore", "pipe"] },
);
await chmod(file, 0o600);
let restored = false;
if (process.argv.includes("--verify-restore")) {
  const name = "cfstudio_restore_verify_" + Date.now();
  const owner = new pg.Client({ connectionString: admin.href });
  await owner.connect();
  let created = false;
  try {
    await owner.query("CREATE DATABASE " + name);
    created = true;
    const target = new URL(admin.href);
    target.pathname = "/" + name;
    execFileSync(
      bin + "pg_restore",
      ["--no-owner", "--no-acl", "--exit-on-error", "--dbname", name, file],
      { env: environment(target), stdio: ["ignore", "ignore", "pipe"] },
    );
    const original = new pg.Client({ connectionString: app.href }),
      copy = new pg.Client({ connectionString: target.href });
    await original.connect();
    await copy.connect();
    try {
      for (const table of [
        "tenants",
        "users",
        "catalog_items",
        "import_origins",
        "artifacts",
        "cf_schema_migrations",
      ]) {
        const sql = "SELECT count(*)::int AS n FROM " + table;
        const a = (await original.query(sql)).rows[0].n,
          b = (await copy.query(sql)).rows[0].n;
        if (a !== b) throw new Error("RESTORE_COUNT_MISMATCH");
      }
      restored = true;
    } finally {
      await original.end();
      await copy.end();
    }
  } finally {
    if (created) await owner.query("DROP DATABASE " + name + " WITH (FORCE)");
    await owner.end();
  }
}
console.log(
  JSON.stringify({ backup: file, restoreVerified: restored, sourceWrites: 0 }),
);
