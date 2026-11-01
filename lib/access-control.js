import { StudioError } from "./errors.js";
export function assertAccess(actor, object, capability) {
  if (!actor || actor.status !== "active" || actor.tenantStatus !== "active")
    throw new StudioError("ACCESS_DENIED", "Akses ditolak.", 403);
  if (!actor.tenantId || actor.tenantId !== object.tenantId)
    throw new StudioError("ACCESS_DENIED", "Akses ditolak.", 403);
  if (!actor.capabilities?.includes(capability))
    throw new StudioError(
      "CAPABILITY_REQUIRED",
      "Hak tindakan tidak tersedia.",
      403,
    );
  if (
    object.brandId &&
    !actor.allBrands &&
    !actor.brandIds?.includes(object.brandId)
  )
    throw new StudioError(
      "BRAND_ACCESS_DENIED",
      "Brand tidak ditugaskan.",
      403,
    );
  return true;
}
