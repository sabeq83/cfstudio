import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  randomUUID,
} from "node:crypto";
import { getPool, transaction } from "./db-pg.js";
import { assertAccess } from "./access-control.js";
import { StudioError } from "./errors.js";
import { audit } from "./idempotency.js";
function master() {
  const key = Buffer.from(process.env.CF_MASTER_KEY_B64 || "", "base64");
  if (key.length !== 32)
    throw new StudioError(
      "ENCRYPTION_NOT_CONFIGURED",
      "Master key koneksi belum diatur.",
      503,
    );
  return key;
}
export function encryptSecret(value) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", master(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(".");
}
export function decryptSecret(value) {
  const [version, iv, tag, data] = String(value).split(".");
  if (version !== "v1") throw new Error("CIPHERTEXT_INVALID");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    master(),
    Buffer.from(iv, "base64url"),
  );
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      cipher.update(Buffer.from(data, "base64url")),
      cipher.final(),
    ]).toString("utf8"),
  );
}
const kinds = ["gemini", "glabs", "minimax", "telegram", "repliz"];
export async function saveConnection(actor, input) {
  assertAccess(
    actor,
    { tenantId: actor.tenantId, brandId: input.brandId },
    "integration.manage",
  );
  if (!kinds.includes(input.kind) || !input.label?.trim())
    throw new StudioError(
      "CONNECTION_INVALID",
      "Jenis dan nama koneksi wajib.",
    );
  if (!input.brandId && !actor.allBrands)
    throw new StudioError(
      "GLOBAL_CONNECTION_DENIED",
      "Koneksi tenant memerlukan pengelola seluruh brand.",
      403,
    );
  const config = input.config || {};
  if (config.baseUrl) {
    const url = new URL(config.baseUrl);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new StudioError("URL_INVALID", "Endpoint tidak valid.");
    if (url.protocol === "http:" && input.kind !== "glabs")
      throw new StudioError("HTTPS_REQUIRED", "Provider ini wajib HTTPS.");
  }
  const required =
    input.kind === "repliz"
      ? ["accessKey", "secretKey"]
      : input.kind === "telegram"
        ? ["botToken"]
        : ["apiKey"];
  if (
    required.some(
      (key) =>
        typeof input.secret?.[key] !== "string" || !input.secret[key].trim(),
    )
  )
    throw new StudioError(
      "CREDENTIAL_REQUIRED",
      "Credential koneksi wajib diisi.",
    );
  const cipher = encryptSecret(input.secret);
  return transaction(async (db) => {
    await db.query(
      `UPDATE connections SET status='superseded' WHERE tenant_id=$1 AND kind=$2 AND brand_id IS NOT DISTINCT FROM $3`,
      [actor.tenantId, input.kind, input.brandId || null],
    );
    const result = await db.query(
      "INSERT INTO connections(id,tenant_id,brand_id,kind,label,config,secret_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,brand_id,kind,label,config,status,revision",
      [
        randomUUID(),
        actor.tenantId,
        input.brandId || null,
        input.kind,
        input.label.trim(),
        config,
        cipher,
      ],
    );
    await audit(
      db,
      actor,
      "connection.created",
      { id: result.rows[0].id, kind: input.kind },
      input.brandId,
    );
    return result.rows[0];
  });
}
export async function listConnections(actor) {
  assertAccess(actor, { tenantId: actor.tenantId }, "integration.manage");
  return (
    await getPool().query(
      "SELECT id,brand_id,kind,label,config,status,revision FROM connections WHERE tenant_id=$1 AND ($2::boolean OR brand_id=ANY($3::text[]))",
      [actor.tenantId, actor.allBrands, actor.brandIds],
    )
  ).rows;
}
export async function resolveConnection(tenantId, brandId, kind) {
  const { rows } = await getPool().query(
    `SELECT * FROM connections WHERE tenant_id=$1 AND kind=$2 AND status='configured' AND (brand_id=$3 OR brand_id IS NULL) ORDER BY brand_id NULLS LAST LIMIT 1`,
    [tenantId, kind, brandId],
  );
  if (!rows[0])
    throw new StudioError(
      "CONNECTION_REQUIRED",
      "Koneksi " + kind + " belum diatur.",
      503,
    );
  return { ...rows[0], secret: decryptSecret(rows[0].secret_ciphertext) };
}

export async function connectionById(tenantId, id) {
  const row = (
    await getPool().query(
      "SELECT * FROM connections WHERE tenant_id=$1 AND id=$2 AND status IN('configured','superseded')",
      [tenantId, id],
    )
  ).rows[0];
  if (!row)
    throw new StudioError(
      "PROVIDER_ROUTE_UNAVAILABLE",
      "Koneksi asal job tidak tersedia.",
      503,
    );
  return { ...row, secret: decryptSecret(row.secret_ciphertext) };
}
