import {
  uploadCatalogFile,
  approveProductPhoto,
  queueCatalogAnalysis,
  listCatalogJobs,
} from "../../../../lib/lab-service.js";
import { requireSession } from "../../../../lib/auth.js";
import { getPool } from "../../../../lib/db-pg.js";
import { assertAccess } from "../../../../lib/access-control.js";
import { StudioError } from "../../../../lib/errors.js";
import {
  listCatalog,
  requireCatalog,
  saveCatalog,
  archiveCatalog,
  listAssignments,
  assignExisting,
} from "../../../../lib/catalog-service.js";
import {
  listRoutines,
  saveRoutine,
  activateRoutine,
  runOnce,
  routineState,
} from "../../../../lib/automation-service.js";
import {
  approveFinal,
  approveCreative,
  editContent,
  retryItem,
  regenerateItem,
  archiveItem,
} from "../../../../lib/review-service.js";
import {
  listOperational,
  listUsers,
  createUser,
} from "../../../../lib/operations-service.js";
import {
  saveConnection,
  listConnections,
} from "../../../../lib/connections.js";
import {
  listAccounts,
  syncAccounts,
  createPublishingIntent,
  cancelIntent,
  reconcileIntent,
} from "../../../../lib/publishing-service.js";
import {
  startTelegramVerification,
  finishTelegramVerification,
  listTelegramBots,
} from "../../../../lib/notification-service.js";
import { loginUser, logout } from "../../../../lib/login-service.js";
import {
  loadArtifact,
  verifyMediaSignature,
} from "../../../../lib/artifact-store.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (data) =>
  Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
function fail(e) {
  return Response.json(
    {
      error: e.code || "REQUEST_FAILED",
      message:
        e instanceof StudioError
          ? e.message
          : "Permintaan belum dapat diproses.",
    },
    {
      status: e instanceof StudioError ? e.status : 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
async function media(request, s) {
  const tenantId = s[1],
    id = s[2],
    u = new URL(request.url);
  const signed =
    u.searchParams.has("signature") &&
    verifyMediaSignature(
      tenantId,
      id,
      u.searchParams.get("expires"),
      u.searchParams.get("signature"),
    );
  if (!signed) {
    const actor = await requireSession(request);
    assertAccess(actor, { tenantId }, "catalog.read");
    const metadata = (
      await getPool().query(
        "SELECT brand_id,object_id FROM artifacts WHERE tenant_id=$1 AND id=$2",
        [tenantId, id],
      )
    ).rows[0];
    if (!metadata)
      throw new StudioError("NOT_FOUND", "Media tidak ditemukan.", 404);
    assertAccess(
      actor,
      { tenantId, brandId: metadata.brand_id },
      "catalog.read",
    );
    if (!metadata.brand_id && !actor.allBrands)
      await requireCatalog(getPool(), actor, metadata.object_id);
  }
  const { asset, buffer } = await loadArtifact(tenantId, id);
  return new Response(buffer, {
    headers: {
      "Content-Type": asset.mime_type,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="${asset.id}"`,
    },
  });
}
export async function GET(request, context) {
  try {
    const { segments: s } = await context.params;
    if (s[0] === "media") return await media(request, s);
    const actor = await requireSession(request);
    if (s[0] === "me") return json(actor);
    if (s[0] === "catalog") return json(await listCatalog(actor, s[1]));
    if (s[0] === "assignments") return json(await listAssignments(actor, s[1]));
    if (s[0] === "routines") return json(await listRoutines(actor));
    if (["items", "runs", "publishing", "history"].includes(s[0]))
      return json(await listOperational(actor, s[0]));
    if (s[0] === "catalog-jobs") return json(await listCatalogJobs(actor));
    if (s[0] === "connections") return json(await listConnections(actor));
    if (s[0] === "accounts") return json(await listAccounts(actor));
    if (s[0] === "users") return json(await listUsers(actor));
    if (s.join("/") === "telegram/bots")
      return json(await listTelegramBots(actor));
    if (s[0] === "notifications") {
      const row = (
        await getPool().query(
          "SELECT verified,enabled,quiet_start,quiet_end,timezone,events FROM notification_preferences WHERE tenant_id=$1 AND user_id=$2",
          [actor.tenantId, actor.id],
        )
      ).rows[0];
      return json(row || { verified: false });
    }
    throw new StudioError("NOT_FOUND", "Tidak ditemukan.", 404);
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request, context) {
  try {
    const { segments: s } = await context.params;
    if (
      ![
        "http://127.0.0.1:3100",
        "http://localhost:3100",
        ...(process.env.CF_PUBLIC_BASE_URL
          ? [new URL(process.env.CF_PUBLIC_BASE_URL).origin]
          : []),
      ].includes(request.headers.get("origin"))
    )
      throw new StudioError("ORIGIN_DENIED", "Origin tidak valid.", 403);
    if (s[0] === "upload") {
      if (Number(request.headers.get("content-length") || 0) > 22 * 1024 * 1024)
        throw new StudioError("FILE_INVALID", "File maksimal 20 MB.");
      const actor = await requireSession(request);
      const form = await request.formData();
      return json(
        await uploadCatalogFile(
          actor,
          {
            objectId: form.get("objectId"),
            expectedRevision: form.get("expectedRevision"),
          },
          form.get("file"),
        ),
      );
    }
    const reader = request.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) {
          await reader.cancel();
          throw new StudioError(
            "REQUEST_TOO_LARGE",
            "Permintaan terlalu besar.",
            413,
          );
        }
        chunks.push(Buffer.from(value));
      }
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if (text.length > 1024 * 1024)
      throw new StudioError(
        "REQUEST_TOO_LARGE",
        "Permintaan terlalu besar.",
        413,
      );
    let b;
    try {
      b = JSON.parse(text);
    } catch {
      throw new StudioError("JSON_INVALID", "Data tidak valid.");
    }
    if (s[0] === "login") {
      const session = await loginUser(b);
      return Response.json(
        { ok: true },
        {
          headers: {
            "Cache-Control": "no-store",
            "Set-Cookie": `cf_session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
          },
        },
      );
    }
    const actor = await requireSession(request);
    if (s[0] === "logout") {
      await logout(request);
      return Response.json(
        { ok: true },
        {
          headers: {
            "Set-Cookie":
              "cf_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
          },
        },
      );
    }
    const key = request.headers.get("Idempotency-Key");
    let data;
    if (s[0] === "catalog" && s[2] === "analyze")
      data = await queueCatalogAnalysis(actor, s[1], b.revision);
    else if (s[0] === "catalog" && s[2] === "approve-photo")
      data = await approveProductPhoto(actor, s[1], b.revision);
    else if (s[0] === "catalog")
      data =
        s[2] === "archive"
          ? await archiveCatalog(actor, s[1], b.expectedRevision)
          : await saveCatalog(actor, b);
    else if (s[0] === "assignments")
      data = await assignExisting(actor, s[1], b);
    else if (s[0] === "routines") {
      if (s.length === 1) data = await saveRoutine(actor, b);
      else if (s[2] === "activate")
        data = await activateRoutine(actor, s[1], b.revision);
      else if (s[2] === "run-once") data = await runOnce(actor, s[1], b, key);
      else data = await routineState(actor, s[1], b.revision, s[2]);
    } else if (s[0] === "items") {
      if (s[2] === "archive") data = await archiveItem(actor, s[1], b.revision);
      else if (s[2] === "approve")
        data = await approveFinal(actor, s[1], b.revision);
      else if (s[2] === "approve-creative")
        data = await approveCreative(actor, s[1], b.revision);
      else if (s[2] === "edit") data = await editContent(actor, s[1], b);
      else if (s[2] === "regenerate")
        data = await regenerateItem(actor, s[1], b);
      else if (s[2] === "retry") data = await retryItem(actor, s[1], b);
      else if (s[2] === "schedule")
        data = await createPublishingIntent(actor, s[1], b, key);
    } else if (s[0] === "publishing")
      data =
        s[2] === "cancel"
          ? await cancelIntent(actor, s[1])
          : await reconcileIntent(actor, s[1], b);
    else if (s[0] === "connections") data = await saveConnection(actor, b);
    else if (s[0] === "accounts") data = await syncAccounts(actor, b);
    else if (s[0] === "users") data = await createUser(actor, b);
    else if (s[0] === "telegram")
      data =
        s[1] === "start"
          ? await startTelegramVerification(actor, b)
          : await finishTelegramVerification(actor, b);
    if (data === undefined)
      throw new StudioError("NOT_FOUND", "Tidak ditemukan.", 404);
    return json(data);
  } catch (e) {
    return fail(e);
  }
}
