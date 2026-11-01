import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import {
  randomUUID,
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { getPool } from "./db-pg.js";
import { StudioError } from "./errors.js";
export function storageRoot() {
  return path.resolve(
    process.env.CF_STORAGE_ROOT || path.join(process.cwd(), "storage"),
  );
}
function segment(value) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value))
    throw new StudioError("ASSET_PATH_INVALID", "Path asset tidak valid.");
  return value;
}
export async function saveArtifact({
  tenantId,
  brandId = null,
  objectId,
  revision,
  kind,
  buffer,
  mimeType,
  extension = "bin",
}) {
  const id = randomUUID(),
    relative = path.join(
      segment(tenantId),
      segment(objectId),
      String(Number(revision)),
      id + "." + segment(extension),
    );
  const absolute = path.join(storageRoot(), relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, buffer, { flag: "wx", mode: 0o600 });
  const sha = createHash("sha256").update(buffer).digest("hex");
  const row = (
    await getPool().query(
      "INSERT INTO artifacts(id,tenant_id,brand_id,object_id,revision,kind,relative_path,sha256,byte_size,mime_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
      [
        id,
        tenantId,
        brandId,
        objectId,
        revision,
        kind,
        relative,
        sha,
        buffer.length,
        mimeType,
      ],
    )
  ).rows[0];
  return row;
}
export async function loadArtifact(tenantId, id) {
  const a = (
    await getPool().query(
      "SELECT * FROM artifacts WHERE tenant_id=$1 AND id=$2",
      [tenantId, id],
    )
  ).rows[0];
  if (!a)
    throw new StudioError("ASSET_NOT_FOUND", "Asset tidak ditemukan.", 404);
  const resolved = path.resolve(storageRoot(), a.relative_path);
  if (!resolved.startsWith(storageRoot() + path.sep))
    throw new Error("ASSET_PATH_INVALID");
  const buffer = await readFile(resolved);
  if (createHash("sha256").update(buffer).digest("hex") !== a.sha256)
    throw new StudioError(
      "ASSET_CHECKSUM_MISMATCH",
      "Integritas asset tidak cocok.",
      409,
    );
  return { asset: a, buffer };
}
export function mediaSignature(tenantId, id, expires) {
  if (!process.env.CF_MEDIA_SIGNING_KEY)
    throw new StudioError(
      "MEDIA_SIGNING_REQUIRED",
      "Media signing belum dikonfigurasi.",
      503,
    );
  return createHmac("sha256", process.env.CF_MEDIA_SIGNING_KEY)
    .update(JSON.stringify([tenantId, id, String(expires)]))
    .digest("hex");
}
export function signedMediaUrl(asset, ttl = 3600) {
  const base = process.env.CF_PUBLIC_BASE_URL;
  if (!base)
    throw new StudioError(
      "PUBLIC_MEDIA_URL_REQUIRED",
      "Public media origin untuk provider belum diatur.",
      503,
    );
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const origin = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${origin}/api/v3/media/${encodeURIComponent(asset.tenant_id)}/${encodeURIComponent(asset.id)}?expires=${exp}&signature=${mediaSignature(asset.tenant_id, asset.id, exp)}`;
}
export function verifyMediaSignature(tenantId, id, expires, signature) {
  if (
    !/^[0-9]+$/.test(String(expires)) ||
    Number(expires) < Date.now() / 1000 ||
    Number(expires) > Date.now() / 1000 + 86400 ||
    !/^[a-f0-9]{64}$/.test(signature || "")
  )
    return false;
  const expected = Buffer.from(mediaSignature(tenantId, id, expires), "hex"),
    provided = Buffer.from(signature, "hex");
  return (
    expected.length === provided.length && timingSafeEqual(expected, provided)
  );
}
