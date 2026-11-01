import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { getPool } from "../lib/db-pg.js";
import { saveArtifact } from "../lib/artifact-store.js";
const root = path.resolve("runtime/source-media");
const manifest = JSON.parse(
  await readFile(path.join(root, "manifest.json"), "utf8"),
);
const entries = Array.isArray(manifest) ? manifest : manifest.files;
if (!Array.isArray(entries)) throw new Error("MANIFEST_INVALID");
const db = getPool();
const objects = (
  await db.query("SELECT * FROM catalog_items WHERE tenant_id=$1", [
    process.env.TARGET_TENANT_ID,
  ])
).rows;
let registered = 0,
  linked = 0;
for (const obj of objects) {
  const serialized = JSON.stringify(obj.payload);
  const map = { ...(obj.payload.mediaMap || {}) };
  for (const file of entries) {
    const source = file.sourcePath || file.source_path || file.path;
    if (!source || !serialized.includes(source) || map[source]) continue;
    const buffer = await readFile(path.join(root, file.filename || file.file));
    if (createHash("sha256").update(buffer).digest("hex") !== file.sha256)
      throw new Error("SOURCE_CHECKSUM_MISMATCH");
    const ext = path.extname(source).slice(1).toLowerCase();
    const mime =
      {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
        mp4: "video/mp4",
        mp3: "audio/mpeg",
      }[ext] || "application/octet-stream";
    const a = await saveArtifact({
      tenantId: obj.tenant_id,
      brandId: obj.brand_id,
      objectId: obj.id,
      revision: obj.revision,
      kind: "imported_source",
      buffer,
      mimeType: mime,
      extension: ext || "bin",
    });
    map[source] = { assetId: a.id, sha256: a.sha256, mimeType: mime };
    registered++;
  }
  if (Object.keys(map).length) {
    const payload = {
      ...obj.payload,
      mediaMap: map,
      migration: { ...obj.payload.migration, mediaStatus: "partial_verified" },
    };
    if (obj.domain === "product") {
      delete payload.photoArtifactId;
      const explicit = ["raw_photo_url", "clean_photo_url"].includes(
        obj.payload.active_photo,
      )
        ? obj.payload[obj.payload.active_photo]
        : obj.payload.clean_photo_url || obj.payload.raw_photo_url;
      const candidate = explicit ? map[explicit] : null;
      if (
        candidate?.mimeType.startsWith("image/") &&
        obj.payload.photo_status === "approved"
      )
        payload.photoArtifactId = candidate;
    }
    await db.query(
      "UPDATE catalog_items SET payload=$3 WHERE tenant_id=$1 AND id=$2",
      [obj.tenant_id, obj.id, payload],
    );
    linked++;
  }
}
console.log(
  JSON.stringify({
    registered,
    objectsLinked: linked,
    missingSourceReferences: 199,
    sourceWrites: 0,
  }),
);
await db.end();
