import { StudioError } from "./errors.js";
export function readConfig(env = process.env, { requireDatabase = true } = {}) {
  if (requireDatabase && !env.DATABASE_URL)
    throw new StudioError(
      "DATABASE_NOT_CONFIGURED",
      "Database CF Studio belum dikonfigurasi.",
      503,
    );
  return {
    databaseUrl: env.DATABASE_URL || null,
    appRole: env.APP_ROLE || "web",
    poolMax: Math.min(8, Math.max(1, Number(env.PGPOOL_MAX) || 3)),
    productionDispatch: env.ENABLE_PRODUCTION_DISPATCH === "true",
    publishingDispatch: env.ENABLE_PUBLISHING_DISPATCH === "true",
  };
}
export function assertSeparateDatabases(source, target) {
  const a = new URL(source),
    b = new URL(target);
  if (
    a.hostname === b.hostname &&
    (a.port || "5432") === (b.port || "5432") &&
    decodeURIComponent(a.pathname) === decodeURIComponent(b.pathname)
  )
    throw new StudioError(
      "SOURCE_EQUALS_TARGET",
      "Database sumber dan tujuan harus terpisah.",
    );
}
