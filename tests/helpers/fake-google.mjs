import { randomUUID, createHash } from "node:crypto";
import { encryptSecret } from "../../lib/connections.js";
import { getPool } from "../../lib/db-pg.js";
const json = (v, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });
export function fakeGoogle() {
  const files = new Map(),
    requests = [],
    faults = {};
  let uploads = 0;
  const metadata = (f) => {
    const { buffer, ...rest } = f;
    return rest;
  };
  const fetcher = async (url, options = {}) => {
    const u = new URL(url),
      method = options.method || "GET";
    requests.push({ host: u.hostname, path: u.pathname, method });
    if (u.hostname === "oauth2.googleapis.com")
      return json({
        access_token: "TEST_MOCK_ACCESS_TOKEN",
        refresh_token: "TEST_MOCK_REFRESH_TOKEN",
        expires_in: 3600,
        scope:
          "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email",
      });
    if (u.pathname === "/oauth2/v2/userinfo")
      return json({ email: "test@example.test" });
    if (u.hostname === "drive.usercontent.google.com") {
      if (options.headers?.Authorization)
        throw new Error("ANONYMOUS_PROBE_HAS_AUTH");
      const f = files.get(u.searchParams.get("id"));
      if (!f || f.trashed || !f.permissions?.some((p) => p.type === "anyone"))
        return json({ error: "not_public" }, 403);
      if (faults.html)
        return new Response("<html>login</html>", {
          headers: { "Content-Type": "text/html" },
        });
      return new Response(f.buffer.subarray(0, 4096), {
        status: 206,
        headers: { "Content-Type": f.mimeType },
      });
    }
    if (u.pathname === "/drive/v3/files/generateIds")
      return json({ ids: ["file-" + randomUUID()] });
    if (u.pathname === "/drive/v3/files" && method === "GET") {
      const q = u.searchParams.get("q") || "";
      const tenant = q.match(/key='cfTenantId' and value='([^']+)'/)?.[1];
      return json({
        files: [...files.values()]
          .filter(
            (f) =>
              f.mimeType === "application/vnd.google-apps.folder" &&
              !f.trashed &&
              (!tenant || f.appProperties?.cfTenantId === tenant),
          )
          .map(metadata),
      });
    }
    if (u.pathname === "/drive/v3/files" && method === "POST") {
      const body = JSON.parse(options.body);
      const f = {
        ...body,
        id: "folder-" + randomUUID(),
        capabilities: { canAddChildren: true },
        trashed: false,
      };
      files.set(f.id, f);
      return json(metadata(f));
    }
    if (u.pathname === "/upload/drive/v3/files") {
      const body = Buffer.from(options.body),
        ct = options.headers["Content-Type"];
      const boundary = ct.split("boundary=")[1];
      const first = body.indexOf("\r\n\r\n") + 4,
        end = body.indexOf("\r\n--" + boundary, first);
      const meta = JSON.parse(body.subarray(first, end).toString());
      const begin = body.indexOf("\r\n\r\n", end) + 4,
        last = body.lastIndexOf("\r\n--" + boundary);
      const buffer = body.subarray(begin, last);
      if (files.has(meta.id)) return json({ error: "exists" }, 409);
      const f = {
        ...meta,
        size: String(buffer.length),
        md5Checksum: createHash("md5").update(buffer).digest("hex"),
        buffer,
        permissions: [],
        trashed: false,
      };
      files.set(f.id, f);
      uploads++;
      if (faults.uploadLost) {
        faults.uploadLost = false;
        throw new Error("TEST_LOST_UPLOAD_RESPONSE");
      }
      return json(metadata(f));
    }
    const match = u.pathname.match(
      /^\/drive\/v3\/files\/([^/]+)(?:\/permissions(?:\/([^/]+))?)?$/,
    );
    if (match) {
      const id = decodeURIComponent(match[1]),
        f = files.get(id);
      if (!f) return json({ error: "missing" }, 404);
      if (u.pathname.includes("/permissions")) {
        if (method === "POST") {
          if (faults.permissionDenied) return json({ error: "policy" }, 403);
          const p = {
            id: "permission-" + randomUUID(),
            ...JSON.parse(options.body),
          };
          f.permissions.push(p);
          return json(p);
        }
        if (method === "DELETE") {
          f.permissions = f.permissions.filter((p) => p.id !== match[2]);
          return new Response(null, { status: 204 });
        }
      }
      if (method === "GET") return json(metadata(f));
      if (method === "PATCH") {
        Object.assign(f, JSON.parse(options.body));
        return json(metadata(f));
      }
    }
    throw new Error("UNEXPECTED_FAKE_GOOGLE_ENDPOINT");
  };
  return {
    files,
    requests,
    faults,
    fetcher,
    get uploads() {
      return uploads;
    },
  };
}
export async function installFakeDrive(actor, fake) {
  const id = "drive-" + randomUUID(),
    folderId = "folder-" + randomUUID();
  fake.files.set(folderId, {
    id: folderId,
    name: "Test Publishing",
    mimeType: "application/vnd.google-apps.folder",
    appProperties: { cfPurpose: "publishing", cfTenantId: actor.tenantId },
    capabilities: { canAddChildren: true },
    trashed: false,
  });
  await getPool().query(
    `INSERT INTO connections(id,tenant_id,kind,label,config,secret_ciphertext) VALUES($1,$2,'google_drive','Test Drive',$3,$4)`,
    [
      id,
      actor.tenantId,
      {
        folderId,
        retentionDays: 14,
        graceDays: 2,
        email: "test@example.test",
        scopes: ["https://www.googleapis.com/auth/drive.file"],
      },
      encryptSecret({
        clientId: "TEST_MOCK_CLIENT",
        clientSecret: "TEST_MOCK_SECRET",
        accessToken: "TEST_MOCK_ACCESS_TOKEN",
        refreshToken: "TEST_MOCK_REFRESH_TOKEN",
        expiresAt: Date.now() + 3600000,
      }),
    ],
  );
  return { id, folderId };
}
