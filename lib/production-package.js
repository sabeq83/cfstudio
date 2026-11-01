import { createHash } from "node:crypto";
import { invariant } from "./errors.js";
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, stable(value[k])]),
    );
  return value;
}
export function fingerprint(value) {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}
export function validatePackage(pkg) {
  invariant(
    pkg.schemaVersion === 1,
    "PACKAGE_VERSION",
    "Versi paket tidak dikenali.",
  );
  invariant(
    pkg.tenantId &&
      pkg.brandId &&
      pkg.itemId &&
      Number.isInteger(pkg.revision) &&
      pkg.revision > 0,
    "PACKAGE_IDENTITY",
    "Identitas paket tidak lengkap.",
  );
  invariant(
    ["video", "static"].includes(pkg.outputKind),
    "OUTPUT_KIND",
    "Jenis output tidak valid.",
  );
  invariant(
    Array.isArray(pkg.scenes) && pkg.scenes.length > 0,
    "SCENES_REQUIRED",
    "Scene wajib.",
  );
  invariant(
    new Set(pkg.scenes.map((s) => s.id)).size === pkg.scenes.length &&
      pkg.scenes.every((s) => typeof s.id === "string" && s.id),
    "SCENE_ID",
    "ID scene wajib unik.",
  );
  for (const scene of pkg.scenes) {
    invariant(
      scene.imagePrompt || scene.videoPrompt,
      "PROMPT_REQUIRED",
      "Prompt scene wajib.",
    );
    if (scene.referenceCritical)
      invariant(
        scene.references?.length &&
          scene.references.every((r) => r.assetId && r.sha256),
        "REFERENCE_REQUIRED",
        "Reference produk wajib terverifikasi.",
      );
    if (pkg.outputKind === "video") {
      invariant(
        ["i2v", "t2v"].includes(scene.mode),
        "VISUAL_MODE",
        "Mode visual wajib.",
      );
      invariant(scene.duration > 0, "DURATION", "Durasi wajib.");
      invariant(scene.videoPrompt, "VIDEO_PROMPT", "Prompt video wajib.");
      if (scene.mode === "i2v")
        invariant(
          scene.imagePrompt || scene.startFrameAssetId,
          "START_FRAME",
          "Start frame wajib.",
        );
      if (pkg.audioMode === "tts")
        invariant(
          scene.narration || scene.voiceSegments?.length,
          "NARRATION",
          "Narasi wajib.",
        );
    }
  }
  if (pkg.outputKind === "video") {
    invariant(
      ["tts", "native", "silent"].includes(pkg.audioMode),
      "AUDIO_MODE",
      "Mode audio wajib.",
    );
    invariant(pkg.mux, "MUX_SETTINGS", "Pengaturan mux wajib.");
  }
  const copy = structuredClone(pkg);
  delete copy.fingerprint;
  return { ...copy, fingerprint: fingerprint(copy) };
}
