import { validatePackage } from "./production-package.js";
import { invariant } from "./errors.js";
export function stagesFor(input) {
  const pkg = validatePackage(input);
  if (pkg.outputKind === "static") return ["images", "static_finishing"];
  const stages = [];
  if (pkg.scenes.some((s) => s.mode === "i2v")) stages.push("start_frames");
  stages.push("creative_gate");
  if (pkg.audioMode === "tts") stages.push("tts");
  return [...stages, "clips", "ffmpeg", "artifacts"];
}
export async function executePackage(input, services, context) {
  const pkg = validatePackage(input);
  invariant(
    context.tenantId === pkg.tenantId,
    "TENANT_MISMATCH",
    "Tenant paket tidak cocok.",
  );
  const results = {};
  for (const stage of stagesFor(pkg)) {
    invariant(
      typeof services[stage] === "function",
      "STAGE_NOT_CONFIGURED",
      `Tahap ${stage} belum dikonfigurasi.`,
    );
    results[stage] = await services[stage](pkg, { ...context, results });
  }
  return results;
}
