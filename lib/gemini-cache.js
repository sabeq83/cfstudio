import { createHash } from "node:crypto";
import { getPool } from "./db-pg.js";
// Cache only a long text request, scoped to tenant + credential + exact model + exact prompt.
// Cache preparation failure never repeats generation and falls back to the original inline input.
export async function cachedPrompt(connection, model, prompt, fetcher) {
  if (
    !connection.tenant_id ||
    connection.config.tier !== "paid" ||
    connection.config.contextCaching !== true ||
    prompt.length < 8192
  )
    return null;
  const db = getPool(),
    hash = createHash("sha256").update(prompt).digest("hex"),
    args = [connection.tenant_id, connection.id, model, hash];
  const row = (
    await db.query(
      "SELECT * FROM gemini_context_caches WHERE tenant_id=$1 AND connection_id=$2 AND model=$3 AND prompt_hash=$4 AND expires_at>now()",
      args,
    )
  ).rows[0];
  if (row) return row.status === "ready" ? row.cache_name : null;
  const claimed = await db.query(
    `INSERT INTO gemini_context_caches(tenant_id,connection_id,model,prompt_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '15 minutes') ON CONFLICT(tenant_id,connection_id,model,prompt_hash) DO UPDATE SET status='creating',cache_name=NULL,error_code=NULL,expires_at=EXCLUDED.expires_at WHERE gemini_context_caches.expires_at<now() RETURNING model`,
    args,
  );
  if (!claimed.rowCount) return null;
  try {
    const r = await fetcher(
      new URL(
        "v1beta/cachedContents",
        connection.config.baseUrl ||
          "https://generativelanguage.googleapis.com/",
      ),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": connection.secret.apiKey,
        },
        body: JSON.stringify({
          model: "models/" + model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          ttl: "900s",
        }),
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      },
    );
    const value = await r.json();
    if (!r.ok || !/^cachedContents\/[a-zA-Z0-9_-]+$/.test(value.name || ""))
      throw Object.assign(new Error("CACHE_REJECTED"), {
        code: r.ok ? "CACHE_INVALID_RESPONSE" : "CACHE_REQUEST_REJECTED",
      });
    const remote = new Date(value.expireTime);
    const expiry = Number.isFinite(remote.getTime())
      ? new Date(Math.min(remote.getTime() - 30000, Date.now() + 870000))
      : new Date(Date.now() + 870000);
    await db.query(
      `UPDATE gemini_context_caches SET status='ready',cache_name=$5,expires_at=$6 WHERE tenant_id=$1 AND connection_id=$2 AND model=$3 AND prompt_hash=$4`,
      [...args, value.name, expiry],
    );
    return value.name;
  } catch (e) {
    await db.query(
      `UPDATE gemini_context_caches SET status='unavailable',error_code=$5 WHERE tenant_id=$1 AND connection_id=$2 AND model=$3 AND prompt_hash=$4`,
      [...args, e.code || "CACHE_OUTCOME_UNKNOWN"],
    );
    return null;
  }
}
export async function invalidateCache(connection, cacheName) {
  await getPool().query(
    "UPDATE gemini_context_caches SET status='unavailable',error_code='CACHE_MISSING' WHERE tenant_id=$1 AND connection_id=$2 AND cache_name=$3",
    [connection.tenant_id, connection.id, cacheName],
  );
}
