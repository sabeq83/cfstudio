import { createHash } from "node:crypto";
import { getPool, transaction } from "./db-pg.js";
import { verifyPassword, sessionToken } from "./security.js";
import { StudioError } from "./errors.js";
export async function loginUser(input) {
  if (
    typeof input.tenantId !== "string" ||
    typeof input.username !== "string" ||
    typeof input.password !== "string" ||
    input.password.length > 512
  )
    throw new StudioError("LOGIN_FAILED", "Login gagal.", 401);
  const key = createHash("sha256")
    .update(input.tenantId + ":" + input.username)
    .digest("hex");
  await transaction(async (db) => {
    await db.query(
      `INSERT INTO login_attempts(key,attempts) VALUES($1,1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_attempts.window_started_at<now()-interval '15 minutes' THEN 1 ELSE login_attempts.attempts+1 END,window_started_at=CASE WHEN login_attempts.window_started_at<now()-interval '15 minutes' THEN now() ELSE login_attempts.window_started_at END`,
      [key],
    );
    const attempt = (
      await db.query("SELECT attempts FROM login_attempts WHERE key=$1", [key])
    ).rows[0];
    if (attempt.attempts > 10)
      throw new StudioError(
        "LOGIN_RATE_LIMIT",
        "Terlalu banyak percobaan. Tunggu 15 menit.",
        429,
      );
  });
  const db = getPool(),
    user = (
      await db.query(
        `SELECT u.*,t.status AS tenant_status FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.tenant_id=$1 AND u.username=$2`,
        [input.tenantId, input.username],
      )
    ).rows[0];
  if (
    !user ||
    user.status !== "active" ||
    user.tenant_status !== "active" ||
    !verifyPassword(input.password, user.password_hash)
  )
    throw new StudioError("LOGIN_FAILED", "Login gagal.", 401);
  const session = sessionToken();
  await db.query(
    `INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')`,
    [session.hash, user.id],
  );
  await db.query("DELETE FROM login_attempts WHERE key=$1", [key]);
  return session;
}
export async function logout(request) {
  const token = (request.headers.get("cookie") || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("cf_session="))
    ?.slice(11);
  if (token)
    await getPool().query("DELETE FROM sessions WHERE token_hash=$1", [
      createHash("sha256").update(token).digest("hex"),
    ]);
  return { loggedOut: true };
}
