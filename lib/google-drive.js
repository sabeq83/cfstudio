import { randomUUID, randomBytes, createHash } from "node:crypto";
import { getPool, transaction } from "./db-pg.js";
import { encryptSecret, decryptSecret, connectionById } from "./connections.js";
import { requireIntegrationAdmin } from "./gemini-pool.js";
import { actorForUser } from "./operations-service.js";
import { loadArtifact } from "./artifact-store.js";
import { StudioError } from "./errors.js";
import { audit } from "./idempotency.js";
import { requireDispatch } from "./provider-gateway.js";
let http = (...args) => fetch(...args);
export function setGoogleTestFetch(fn) {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY");
  http = fn || ((...args) => fetch(...args));
}
const hash = (s) => createHash("sha256").update(s).digest("hex");
const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
];
function baseOrigin() {
  const value = process.env.CF_PUBLIC_BASE_URL || "http://127.0.0.1:3100";
  const u = new URL(value);
  if (
    u.protocol !== "https:" &&
    !["127.0.0.1", "localhost"].includes(u.hostname)
  )
    throw new StudioError(
      "OAUTH_ORIGIN_INVALID",
      "OAuth memerlukan HTTPS atau localhost.",
    );
  return u.origin;
}
export function googleRedirectUri() {
  return baseOrigin() + "/api/v3/google/callback";
}
async function request(url, options = {}) {
  try {
    return await http(url, {
      ...options,
      signal: AbortSignal.timeout(120000),
      redirect: "error",
    });
  } catch {
    throw new StudioError(
      "GOOGLE_OUTCOME_UNKNOWN",
      "Hasil permintaan Google belum dapat dipastikan.",
      503,
    );
  }
}
async function tokenRequest(params) {
  const r = await request("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  let data = {};
  try {
    data = await r.json();
  } catch {}
  if (!r.ok)
    throw new StudioError(
      data.error === "invalid_grant"
        ? "GOOGLE_REAUTH_REQUIRED"
        : "GOOGLE_TOKEN_FAILED",
      "Koneksi Google memerlukan pemeriksaan atau otorisasi ulang.",
      503,
    );
  return data;
}
export async function saveGoogleConfig(actor, input) {
  requireIntegrationAdmin(actor);
  if (!input.clientId?.trim())
    throw new StudioError(
      "GOOGLE_CLIENT_REQUIRED",
      "Client ID OAuth CF Studio wajib.",
    );
  const db = getPool();
  const old = (
    await db.query(
      `SELECT * FROM connections WHERE tenant_id=$1 AND kind='google_drive' AND status IN('configured','pending_auth','disconnected','disconnecting') ORDER BY CASE WHEN status='pending_auth' THEN 0 ELSE 1 END,revision DESC LIMIT 1`,
      [actor.tenantId],
    )
  ).rows[0];
  if (old?.status === "disconnecting")
    throw new StudioError(
      "GOOGLE_DISCONNECT_PENDING",
      "Selesaikan pelepasan Google terlebih dahulu.",
      409,
    );
  const previous = old ? decryptSecret(old.secret_ciphertext) : {};
  const secret = {
    clientId: input.clientId.trim(),
    clientSecret: input.clientSecret?.trim() || previous.clientSecret,
  };
  if (!secret.clientSecret)
    throw new StudioError(
      "GOOGLE_SECRET_REQUIRED",
      "Client secret OAuth wajib.",
    );
  const same =
    old &&
    previous.clientId === secret.clientId &&
    previous.clientSecret === secret.clientSecret;
  const id = same ? old.id : randomUUID();
  const days = Number(input.retentionDays ?? 14),
    grace = Number(input.graceDays ?? 2);
  if (
    !Number.isInteger(days) ||
    days < 1 ||
    days > 365 ||
    !Number.isInteger(grace) ||
    grace < 1 ||
    grace > 30
  )
    throw new StudioError(
      "RETENTION_INVALID",
      "Retensi 1–365 hari dan masa tenggang 1–30 hari.",
    );
  const config = {
    ...(same ? old.config : {}),
    retentionDays: days,
    graceDays: grace,
    clientId: secret.clientId,
  };
  if (input.folderId) {
    config.folderId = normalizeFolderId(input.folderId);
    config.folderVerifiedAt = null;
  }
  await transaction(async (tx) => {
    if (same)
      await tx.query(
        "UPDATE connections SET config=$3,revision=revision+1 WHERE tenant_id=$1 AND id=$2",
        [actor.tenantId, id, config],
      );
    else
      await tx.query(
        `INSERT INTO connections(id,tenant_id,kind,label,config,secret_ciphertext,status) VALUES($1,$2,'google_drive','Google Drive Publishing',$3,$4,'pending_auth')`,
        [id, actor.tenantId, config, encryptSecret(secret)],
      );
    await audit(tx, actor, "google.configured", { connectionId: id });
  });
  return {
    id,
    redirectUri: googleRedirectUri(),
    needsAuthorization: !same || old.status !== "configured",
  };
}
export async function googleStatus(actor) {
  requireIntegrationAdmin(actor);
  const rows = (
    await getPool().query(
      `SELECT id,config,status,revision FROM connections WHERE tenant_id=$1 AND kind='google_drive' AND status IN('configured','pending_auth','disconnected','disconnecting') ORDER BY CASE WHEN status='pending_auth' THEN 0 ELSE 1 END,revision DESC`,
      [actor.tenantId],
    )
  ).rows;
  return {
    connections: rows,
    redirectUri: googleRedirectUri(),
    scopes: SCOPES,
  };
}
export async function startGoogleOAuth(actor, id) {
  requireIntegrationAdmin(actor);
  const c = (
    await getPool().query(
      `SELECT * FROM connections WHERE tenant_id=$1 AND id=$2 AND kind='google_drive' AND status IN('configured','pending_auth','disconnected')`,
      [actor.tenantId, id],
    )
  ).rows[0];
  if (!c)
    throw new StudioError(
      "GOOGLE_CONFIG_REQUIRED",
      "Simpan konfigurasi OAuth dahulu.",
    );
  const secret = decryptSecret(c.secret_ciphertext),
    state = randomBytes(32).toString("base64url"),
    nonce = randomBytes(32).toString("base64url"),
    redirectUri = googleRedirectUri();
  await getPool().query(
    `INSERT INTO google_oauth_states(state_hash,tenant_id,actor_id,connection_id,nonce_hash,redirect_uri,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')`,
    [hash(state), actor.tenantId, actor.id, c.id, hash(nonce), redirectUri],
  );
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: secret.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();
  return { authUrl: u.href, nonce };
}
export async function finishGoogleOAuth({ state, code, nonce, error }) {
  if (!state || !nonce)
    throw new StudioError(
      "OAUTH_STATE_INVALID",
      "State OAuth tidak valid.",
      403,
    );
  const consumed = await transaction(async (db) => {
    const row = (
      await db.query(
        "SELECT * FROM google_oauth_states WHERE state_hash=$1 AND expires_at>now() FOR UPDATE",
        [hash(state)],
      )
    ).rows[0];
    if (!row || row.nonce_hash !== hash(nonce))
      throw new StudioError(
        "OAUTH_STATE_INVALID",
        "State OAuth tidak valid atau kedaluwarsa.",
        403,
      );
    await db.query("DELETE FROM google_oauth_states WHERE state_hash=$1", [
      hash(state),
    ]);
    return row;
  });
  if (error || !code)
    throw new StudioError(
      "GOOGLE_CONSENT_DENIED",
      "Otorisasi Google belum diberikan.",
    );
  const actor = await actorForUser(getPool(), consumed.actor_id);
  requireIntegrationAdmin(actor);
  if (actor.tenantId !== consumed.tenant_id)
    throw new StudioError(
      "OAUTH_STATE_INVALID",
      "Tenant OAuth tidak cocok.",
      403,
    );
  const c = await connectionByPendingId(
      consumed.tenant_id,
      consumed.connection_id,
    ),
    secret = decryptSecret(c.secret_ciphertext);
  const tokens = await tokenRequest({
    client_id: secret.clientId,
    client_secret: secret.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: consumed.redirect_uri,
  });
  const scopes = String(tokens.scope || "").split(" ");
  if (!scopes.includes(SCOPES[0]))
    throw new StudioError(
      "GOOGLE_SCOPE_REQUIRED",
      "Izin drive.file belum diberikan.",
    );
  if (!tokens.refresh_token && !secret.refreshToken)
    throw new StudioError(
      "GOOGLE_REAUTH_REQUIRED",
      "Refresh token belum tersedia. Hubungkan ulang Google.",
    );
  const identity = await request(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    { headers: { Authorization: "Bearer " + tokens.access_token } },
  );
  if (!identity.ok)
    throw new StudioError(
      "GOOGLE_IDENTITY_FAILED",
      "Identitas akun Google belum dapat diverifikasi.",
    );
  const profile = await identity.json();
  await transaction(async (db) => {
    await db.query(
      `UPDATE connections SET status='superseded' WHERE tenant_id=$1 AND kind='google_drive' AND status='configured' AND id<>$2`,
      [actor.tenantId, c.id],
    );
    await db.query(
      `UPDATE connections SET status='configured',secret_ciphertext=$3,config=config||$4::jsonb,revision=revision+1 WHERE tenant_id=$1 AND id=$2`,
      [
        actor.tenantId,
        c.id,
        encryptSecret({
          ...secret,
          refreshToken: tokens.refresh_token || secret.refreshToken,
          accessToken: tokens.access_token,
          expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
        }),
        {
          email: profile.email || "",
          scopes,
          connectedAt: new Date().toISOString(),
        },
      ],
    );
    await audit(db, actor, "google.connected", { connectionId: c.id });
  });
  return { connected: true };
}
async function connectionByPendingId(tenantId, id) {
  const c = (
    await getPool().query(
      `SELECT * FROM connections WHERE tenant_id=$1 AND id=$2 AND kind='google_drive' AND status IN('configured','pending_auth','disconnected','disconnecting')`,
      [tenantId, id],
    )
  ).rows[0];
  if (!c)
    throw new StudioError(
      "GOOGLE_CONFIG_REQUIRED",
      "Koneksi Google tidak tersedia.",
    );
  return c;
}
export async function driveConnection(tenantId, id = null, db = getPool()) {
  const c = (
    await db.query(
      `SELECT * FROM connections WHERE tenant_id=$1 AND kind='google_drive' AND ($2::text IS NULL OR id=$2) AND status='configured' ORDER BY revision DESC LIMIT 1 FOR SHARE`,
      [tenantId, id],
    )
  ).rows[0];
  if (!c)
    throw new StudioError(
      "GOOGLE_DRIVE_REQUIRED",
      "Hubungkan Google Drive Publishing di Settings.",
      503,
    );
  return c;
}
async function accessToken(connection) {
  return transaction(async (db) => {
    const row = (
      await db.query(
        `SELECT * FROM connections WHERE tenant_id=$1 AND id=$2 AND status IN('configured','superseded','disconnecting') FOR UPDATE`,
        [connection.tenant_id, connection.id],
      )
    ).rows[0];
    if (!row)
      throw new StudioError(
        "GOOGLE_REAUTH_REQUIRED",
        "Koneksi Google tidak aktif.",
      );
    const s = decryptSecret(row.secret_ciphertext);
    if (s.accessToken && Number(s.expiresAt) > Date.now() + 60000)
      return s.accessToken;
    const data = await tokenRequest({
      client_id: s.clientId,
      client_secret: s.clientSecret,
      refresh_token: s.refreshToken,
      grant_type: "refresh_token",
    });
    if (!data.access_token)
      throw new StudioError(
        "GOOGLE_TOKEN_FAILED",
        "Access token Google belum tersedia.",
      );
    await db.query(
      "UPDATE connections SET secret_ciphertext=$3 WHERE tenant_id=$1 AND id=$2",
      [
        connection.tenant_id,
        connection.id,
        encryptSecret({
          ...s,
          accessToken: data.access_token,
          refreshToken: data.refresh_token || s.refreshToken,
          expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
        }),
      ],
    );
    return data.access_token;
  });
}
async function drive(
  connection,
  method,
  path,
  body,
  { binary = false, contentType = "application/json", allow404 = false } = {},
) {
  const token = await accessToken(connection);
  const r = await request("https://www.googleapis.com/" + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      ...(body ? { "Content-Type": contentType } : {}),
    },
    body: body ? (binary ? body : JSON.stringify(body)) : undefined,
  });
  if (r.status === 404 && allow404) return null;
  if (!r.ok)
    throw new StudioError(
      r.status === 401
        ? "GOOGLE_REAUTH_REQUIRED"
        : r.status === 403
          ? "GOOGLE_PERMISSION_DENIED"
          : r.status === 404
            ? "GOOGLE_FILE_NOT_FOUND"
            : r.status === 409
              ? "GOOGLE_FILE_EXISTS"
              : r.status === 429
                ? "GOOGLE_RATE_LIMIT"
                : "GOOGLE_REQUEST_FAILED",
      "Google Drive belum dapat memproses permintaan (" + r.status + ").",
      503,
    );
  if (r.status === 204) return {};
  try {
    return await r.json();
  } catch {
    throw new StudioError(
      "GOOGLE_RESPONSE_INVALID",
      "Respons Google tidak valid.",
      503,
    );
  }
}
export function normalizeFolderId(value) {
  let id = String(value || "").trim();
  if (id.startsWith("https://")) {
    const u = new URL(id);
    if (u.hostname !== "drive.google.com")
      throw new StudioError("FOLDER_INVALID", "URL folder harus Google Drive.");
    id = u.pathname.split("/folders/")[1]?.split("/")[0] || "";
  }
  if (!/^[a-zA-Z0-9_-]{10,200}$/.test(id))
    throw new StudioError(
      "FOLDER_INVALID",
      "ID folder Google Drive tidak valid.",
    );
  return id;
}
export async function verifyDrive(actor, id = null) {
  requireIntegrationAdmin(actor);
  const c = await driveConnection(actor.tenantId, id);
  return verifyDriveInternal(c);
}
async function verifyDriveInternal(c) {
  if (!c.config.folderId)
    throw new StudioError(
      "GOOGLE_FOLDER_REQUIRED",
      "Buat atau pilih folder publishing.",
    );
  const f = await drive(
    c,
    "GET",
    "drive/v3/files/" +
      encodeURIComponent(c.config.folderId) +
      "?fields=id,name,mimeType,trashed,capabilities,appProperties",
  );
  if (
    f.appProperties?.cfPurpose !== "publishing" ||
    f.appProperties?.cfTenantId !== c.tenant_id
  )
    throw new StudioError(
      "GOOGLE_FOLDER_TENANT_MISMATCH",
      "Gunakan folder khusus tenant CF Studio melalui Buat / perbaiki folder.",
    );
  if (
    f.trashed ||
    f.mimeType !== "application/vnd.google-apps.folder" ||
    f.capabilities?.canAddChildren !== true
  )
    throw new StudioError(
      "GOOGLE_FOLDER_NOT_WRITABLE",
      "Folder tidak tersedia atau tidak dapat ditulis.",
    );
  await getPool().query(
    "UPDATE connections SET config=config||$3::jsonb WHERE tenant_id=$1 AND id=$2",
    [
      c.tenant_id,
      c.id,
      { folderVerifiedAt: new Date().toISOString(), folderName: f.name },
    ],
  );
  return { ok: true, folderId: f.id, folderName: f.name, canWrite: true };
}
export async function ensureDriveFolder(actor, id = null) {
  requireIntegrationAdmin(actor);
  const c = await driveConnection(actor.tenantId, id);
  const tenant = actor.tenantId.replaceAll("'", "\\'");
  const q =
    "mimeType='application/vnd.google-apps.folder' and trashed=false and appProperties has { key='cfPurpose' and value='publishing' } and appProperties has { key='cfTenantId' and value='" +
    tenant +
    "' }";
  const found = await drive(
    c,
    "GET",
    "drive/v3/files?" +
      new URLSearchParams({ q, fields: "files(id,name)", pageSize: "100" }),
  );
  if (found.files?.length > 1)
    throw new StudioError(
      "GOOGLE_FOLDER_AMBIGUOUS",
      "Ada beberapa folder CF Studio. Pilih folder yang akan dipakai.",
    );
  const f =
    found.files?.[0] ||
    (await drive(c, "POST", "drive/v3/files", {
      name: "CF Studio Publishing",
      mimeType: "application/vnd.google-apps.folder",
      appProperties: { cfPurpose: "publishing", cfTenantId: actor.tenantId },
    }));
  await getPool().query(
    "UPDATE connections SET config=config||$3::jsonb WHERE tenant_id=$1 AND id=$2",
    [actor.tenantId, c.id, { folderId: f.id, folderName: f.name }],
  );
  return verifyDrive(actor, c.id);
}
export async function disconnectGoogle(actor, id) {
  requireIntegrationAdmin(actor);
  const db = getPool();
  const c = await connectionByPendingId(actor.tenantId, id);
  await transaction(async (tx) => {
    await tx.query(
      "SELECT id FROM connections WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [actor.tenantId, id],
    );
    const pending = (
      await tx.query(
        `SELECT 1 FROM publishing_intents WHERE tenant_id=$1 AND status NOT IN('published','failed','canceled') LIMIT 1`,
        [actor.tenantId],
      )
    ).rowCount;
    if (pending)
      throw new StudioError(
        "PUBLISHING_ACTIVE",
        "Selesaikan atau batalkan publikasi aktif sebelum melepas Google.",
        409,
      );
    await tx.query(
      "UPDATE connections SET status='disconnecting' WHERE tenant_id=$1 AND id=$2",
      [actor.tenantId, id],
    );
  });
  const copies = (
    await db.query(
      `SELECT * FROM publishing_media WHERE tenant_id=$1 AND connection_id=$2 AND status<>'trashed'`,
      [actor.tenantId, id],
    )
  ).rows;
  for (const copy of copies) {
    if (copy.lease_expires_at && new Date(copy.lease_expires_at) > new Date())
      throw new StudioError(
        "MEDIA_STAGING_PENDING",
        "Salinan masih diproses.",
        409,
      );
    if (copy.file_id) {
      const f = await drive(
        c,
        "GET",
        "drive/v3/files/" +
          encodeURIComponent(copy.file_id) +
          "?fields=id,appProperties,permissions,trashed",
        null,
        { allow404: true },
      );
      if (f) {
        if (
          f.appProperties?.cfTenantId !== actor.tenantId ||
          f.appProperties?.cfPurpose !== "publishing"
        )
          throw new StudioError(
            "DRIVE_OWNERSHIP_MISMATCH",
            "Salinan tidak cocok.",
          );
        for (const permission of f.permissions || [])
          if (permission.type === "anyone")
            await drive(
              c,
              "DELETE",
              "drive/v3/files/" +
                encodeURIComponent(copy.file_id) +
                "/permissions/" +
                encodeURIComponent(permission.id),
              null,
              { allow404: true },
            );
        await drive(
          c,
          "PATCH",
          "drive/v3/files/" + encodeURIComponent(copy.file_id),
          { trashed: true },
        );
      }
    }
    await db.query(
      `UPDATE publishing_media SET status='trashed' WHERE tenant_id=$1 AND id=$2`,
      [actor.tenantId, copy.id],
    );
  }
  const secret = decryptSecret(c.secret_ciphertext);
  await db.query(
    `UPDATE connections SET status='disconnected',secret_ciphertext=$3 WHERE tenant_id=$1 AND id=$2`,
    [
      actor.tenantId,
      id,
      encryptSecret({
        clientId: secret.clientId,
        clientSecret: secret.clientSecret,
      }),
    ],
  );
  return { disconnected: true, copiesTrashed: copies.length };
}
function allowedDownload(u) {
  return (
    u.protocol === "https:" &&
    (u.hostname === "drive.google.com" ||
      u.hostname === "drive.usercontent.google.com" ||
      u.hostname === "driveusercontent.com" ||
      u.hostname.endsWith(".googleusercontent.com"))
  );
}
export async function verifyAnonymousMedia(url, expected) {
  let u = new URL(url);
  for (let n = 0; n < 6; n++) {
    if (!allowedDownload(u))
      throw new StudioError(
        "DRIVE_DOWNLOAD_HOST_INVALID",
        "Host unduh Google tidak valid.",
      );
    let r;
    try {
      r = await http(u.href, {
        headers: { Range: "bytes=0-4095" },
        signal: AbortSignal.timeout(20000),
        redirect: "manual",
      });
    } catch {
      throw new StudioError(
        "DRIVE_DOWNLOAD_FAILED",
        "Media Drive belum dapat diunduh.",
      );
    }
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      u = new URL(r.headers.get("location"), u);
      continue;
    }
    const type = r.headers.get("content-type") || "";
    if (
      !r.ok ||
      type.includes("text/html") ||
      (!type.startsWith(expected.mime_type.split("/")[0] + "/") &&
        !type.startsWith("application/octet-stream"))
    )
      throw new StudioError(
        "DRIVE_DOWNLOAD_NOT_PUBLIC",
        "URL media belum menyediakan file publik yang sesuai.",
      );
    const reader = r.body?.getReader();
    if (!reader)
      throw new StudioError("DRIVE_DOWNLOAD_EMPTY", "File unduh kosong.");
    let bytes = Buffer.alloc(0);
    try {
      while (bytes.length < Math.min(256, expected.buffer.length)) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes = Buffer.concat([bytes, Buffer.from(value)]);
      }
    } finally {
      await reader.cancel();
    }
    if (
      !bytes
        .subarray(0, Math.min(256, expected.buffer.length))
        .equals(
          expected.buffer.subarray(0, Math.min(256, expected.buffer.length)),
        )
    )
      throw new StudioError(
        "DRIVE_DOWNLOAD_MISMATCH",
        "Isi file unduh tidak cocok dengan media final.",
      );
    return true;
  }
  throw new StudioError(
    "DRIVE_DOWNLOAD_FAILED",
    "Terlalu banyak pengalihan Google Drive.",
  );
}
export async function stagePublishingMedia(
  actor,
  item,
  asset,
  scheduledAt,
  workerId,
  intentId = null,
) {
  requireDispatch("publishing");
  const c = await driveConnection(actor.tenantId);
  await verifyDriveInternal(c);
  const { buffer } = await loadArtifact(actor.tenantId, asset.id);
  const retention = new Date(
    Math.max(
      Date.now() + Number(c.config.retentionDays || 14) * 86400000,
      new Date(scheduledAt).getTime() +
        Number(c.config.graceDays || 2) * 86400000,
    ),
  );
  const row = await transaction(async (db) => {
    await db.query(
      `INSERT INTO publishing_media(id,tenant_id,item_id,revision,sha256,connection_id,folder_id,mime_type,byte_size,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(tenant_id,item_id,revision,sha256,connection_id) DO UPDATE SET expires_at=GREATEST(publishing_media.expires_at,EXCLUDED.expires_at)`,
      [
        randomUUID(),
        actor.tenantId,
        item.id,
        item.revision,
        asset.sha256,
        c.id,
        c.config.folderId,
        asset.mime_type,
        asset.byte_size,
        retention,
      ],
    );
    const current = (
      await db.query(
        "SELECT * FROM publishing_media WHERE tenant_id=$1 AND item_id=$2 AND revision=$3 AND sha256=$4 AND connection_id=$5 FOR UPDATE",
        [actor.tenantId, item.id, item.revision, asset.sha256, c.id],
      )
    ).rows[0];
    if (intentId)
      await db.query(
        "UPDATE publishing_intents SET media_id=$3 WHERE tenant_id=$1 AND id=$2 AND item_id=$4 AND revision=$5",
        [actor.tenantId, intentId, current.id, item.id, item.revision],
      );
    if (current.status === "trashed")
      throw new StudioError(
        "DRIVE_COPY_RETIRED",
        "Salinan sudah dibersihkan. Buat revisi baru untuk publikasi berikutnya.",
      );
    if (
      current.lease_expires_at &&
      new Date(current.lease_expires_at) > new Date() &&
      current.lease_owner !== workerId
    )
      throw new StudioError(
        "MEDIA_STAGING_PENDING",
        "Media sedang disiapkan oleh worker lain.",
        503,
      );
    return (
      await db.query(
        `UPDATE publishing_media SET lease_owner=$3,lease_expires_at=now()+interval '5 minutes',fencing_token=fencing_token+1 WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [actor.tenantId, current.id, workerId],
      )
    ).rows[0];
  });
  const fenced = async (fields, values) => {
    const result = await getPool().query(
      `UPDATE publishing_media SET ${fields} WHERE id=$1 AND tenant_id=$2 AND lease_owner=$3 AND fencing_token=$4 AND lease_expires_at>now()`,
      [row.id, actor.tenantId, workerId, row.fencing_token, ...values],
    );
    if (!result.rowCount)
      throw new StudioError("STALE_LEASE", "Lease staging sudah berubah.", 409);
  };
  try {
    let fileId = row.file_id;
    if (!fileId) {
      const ids = await drive(
        c,
        "GET",
        "drive/v3/files/generateIds?count=1&space=drive",
      );
      fileId = ids.ids?.[0];
      if (!fileId)
        throw new StudioError(
          "GOOGLE_FILE_ID_REQUIRED",
          "Google belum memberikan ID file.",
        );
      await fenced("file_id=$5,status='uploading'", [fileId]);
    }
    let remote = await drive(
      c,
      "GET",
      "drive/v3/files/" +
        encodeURIComponent(fileId) +
        "?fields=id,mimeType,size,md5Checksum,appProperties,permissions",
      null,
      { allow404: true },
    );
    if (!remote) {
      const boundary = "cf_" + randomBytes(12).toString("hex");
      const metadata = {
        id: fileId,
        name:
          "cf-" +
          item.id +
          "-r" +
          item.revision +
          (asset.mime_type.startsWith("video/") ? ".mp4" : ".png"),
        parents: [row.folder_id],
        mimeType: asset.mime_type,
        appProperties: {
          cfPurpose: "publishing",
          cfTenantId: actor.tenantId,
          cfItemId: item.id,
          cfRevision: String(item.revision),
          cfSha256: asset.sha256,
        },
      };
      const body = Buffer.concat([
        Buffer.from(
          "--" +
            boundary +
            "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
            JSON.stringify(metadata) +
            "\r\n--" +
            boundary +
            "\r\nContent-Type: " +
            asset.mime_type +
            "\r\n\r\n",
        ),
        buffer,
        Buffer.from("\r\n--" + boundary + "--\r\n"),
      ]);
      try {
        remote = await drive(
          c,
          "POST",
          "upload/drive/v3/files?uploadType=multipart&fields=id,mimeType,size,md5Checksum,appProperties,permissions",
          body,
          {
            binary: true,
            contentType: "multipart/related; boundary=" + boundary,
          },
        );
      } catch (e) {
        if (e.code !== "GOOGLE_FILE_EXISTS") throw e;
        remote = await drive(
          c,
          "GET",
          "drive/v3/files/" +
            encodeURIComponent(fileId) +
            "?fields=id,mimeType,size,md5Checksum,appProperties,permissions",
        );
      }
    }
    if (
      remote.appProperties?.cfTenantId !== actor.tenantId ||
      remote.appProperties?.cfSha256 !== asset.sha256 ||
      remote.mimeType !== asset.mime_type ||
      Number(remote.size) !== buffer.length ||
      remote.md5Checksum !== createHash("md5").update(buffer).digest("hex")
    )
      throw new StudioError(
        "DRIVE_FILE_MISMATCH",
        "Checksum/identitas salinan Drive tidak cocok.",
      );
    let permission = remote.permissions?.find(
      (p) => p.type === "anyone" && p.role === "reader",
    );
    if (!permission)
      permission = await drive(
        c,
        "POST",
        "drive/v3/files/" + encodeURIComponent(fileId) + "/permissions",
        { type: "anyone", role: "reader", allowFileDiscovery: false },
      );
    const url =
      "https://drive.usercontent.google.com/download?" +
      new URLSearchParams({ id: fileId, export: "download", confirm: "t" });
    await verifyAnonymousMedia(url, { mime_type: asset.mime_type, buffer });
    await fenced(
      "status='verified',public_url=$5,permission_id=$6,error_code=NULL,lease_owner=NULL,lease_expires_at=NULL",
      [url, permission.id],
    );
    return { id: row.id, fileId, url, expiresAt: retention };
  } catch (e) {
    await fenced(
      "status='retry_wait',error_code=$5,lease_owner=NULL,lease_expires_at=NULL",
      [e.code || "DRIVE_STAGING_FAILED"],
    );
    throw e;
  }
}
export async function cleanupPublishingMedia(workerId) {
  requireDispatch("publishing");
  const db = getPool();
  const row = await transaction(async (tx) => {
    const current = (
      await tx.query(
        `SELECT m.* FROM publishing_media m JOIN tenants t ON t.id=m.tenant_id AND t.status='active' WHERE m.status IN('verified','retry_wait','uploading','prepared','cleanup_retry') AND m.expires_at<now() AND (m.lease_expires_at IS NULL OR m.lease_expires_at<now()) AND NOT EXISTS(SELECT 1 FROM publishing_intents p WHERE p.tenant_id=m.tenant_id AND p.media_id=m.id AND p.status NOT IN('published','failed','canceled')) ORDER BY m.expires_at FOR UPDATE SKIP LOCKED LIMIT 1`,
      )
    ).rows[0];
    if (!current) return null;
    return (
      await tx.query(
        `UPDATE publishing_media SET lease_owner=$2,lease_expires_at=now()+interval '5 minutes',fencing_token=fencing_token+1 WHERE id=$1 RETURNING *`,
        [current.id, workerId],
      )
    ).rows[0];
  });
  if (!row) return false;
  try {
    const c = await connectionById(row.tenant_id, row.connection_id);
    const f = await drive(
      c,
      "GET",
      "drive/v3/files/" +
        encodeURIComponent(row.file_id) +
        "?fields=id,appProperties,permissions,trashed",
      null,
      { allow404: true },
    );
    if (f) {
      if (
        f.appProperties?.cfTenantId !== row.tenant_id ||
        f.appProperties?.cfPurpose !== "publishing"
      )
        throw new StudioError(
          "DRIVE_OWNERSHIP_MISMATCH",
          "Salinan bukan milik tenant CF Studio.",
        );
      for (const permission of f.permissions || [])
        if (permission.type === "anyone")
          await drive(
            c,
            "DELETE",
            "drive/v3/files/" +
              encodeURIComponent(row.file_id) +
              "/permissions/" +
              encodeURIComponent(permission.id),
            null,
            { allow404: true },
          );
      await drive(
        c,
        "PATCH",
        "drive/v3/files/" + encodeURIComponent(row.file_id),
        { trashed: true },
      );
    }
    await db.query(
      `UPDATE publishing_media SET status='trashed',error_code=NULL,lease_owner=NULL,lease_expires_at=NULL WHERE id=$1 AND lease_owner=$2 AND fencing_token=$3`,
      [row.id, workerId, row.fencing_token],
    );
  } catch (e) {
    await db.query(
      `UPDATE publishing_media SET status='cleanup_retry',error_code=$4,lease_owner=NULL,lease_expires_at=now()+interval '1 hour' WHERE id=$1 AND lease_owner=$2 AND fencing_token=$3`,
      [row.id, workerId, row.fencing_token, e.code || "DRIVE_CLEANUP_FAILED"],
    );
  }
  return true;
}
