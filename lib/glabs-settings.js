import { StudioError } from "./errors.js";
export const imageModels = ["nano_banana_pro", "nano_banana_2"];
export const videoModels = [
  "veo_31_lite",
  "veo_31_fast",
  "veo_31_quality",
  "veo_31_lite_relaxed",
  "veo_31_fast_relaxed",
  "omni_flash",
];
export function workerIdentity(value) {
  try {
    const u = new URL(value);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/"
    )
      throw Error();
    return u.origin + "/";
  } catch {
    throw new StudioError(
      "GLABS_SETTING_INVALID",
      "Host/port worker tidak valid; gunakan alamat tanpa path atau credential.",
    );
  }
}
export function normalizeGlabsConfig(input = {}, previous = {}) {
  const c = {
    imageModel: imageModels[0],
    videoModel: "veo_31_lite_relaxed",
    delayEnabled: true,
    delayMin: 10,
    delayMax: 20,
    maxConcurrent: 2,
    t2iPattern: "threading",
    ...previous,
    ...input,
  };
  for (const k of ["delayMin", "delayMax", "maxConcurrent"]) {
    if (c[k] === "" || c[k] === null || !Number.isInteger(Number(c[k])))
      throw new StudioError(
        "GLABS_SETTING_INVALID",
        "Jeda dan batas pekerjaan harus bilangan bulat.",
      );
    c[k] = Number(c[k]);
  }
  if (
    c.delayMin < 0 ||
    c.delayMax < c.delayMin ||
    c.delayMax > 300 ||
    c.maxConcurrent < 1 ||
    c.maxConcurrent > 10 ||
    !["threading", "sequential"].includes(c.t2iPattern) ||
    typeof c.delayEnabled !== "boolean"
  )
    throw new StudioError(
      "GLABS_SETTING_INVALID",
      "Jeda/pola/batas pekerjaan tidak valid.",
    );
  let baseUrl = c.baseUrl;
  if (input.host !== undefined) {
    const host = String(input.host).trim(),
      port = Number(input.port ?? 8765),
      protocol = input.protocol || "http";
    if (
      !host ||
      /[\s/@?#]/.test(host) ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      !["http", "https"].includes(protocol)
    )
      throw new StudioError(
        "GLABS_SETTING_INVALID",
        "Host/port worker tidak valid.",
      );
    baseUrl = `${protocol}://${host}:${port}/`;
  }
  for (const k of ["imageModel", "videoModel"])
    if (typeof c[k] !== "string" || !/^[a-zA-Z0-9_.-]{1,100}$/.test(c[k]))
      throw new StudioError("GLABS_SETTING_INVALID", "Model tidak valid.");
  return {
    baseUrl: workerIdentity(baseUrl),
    imageModel: c.imageModel,
    videoModel: c.videoModel,
    delayEnabled: c.delayEnabled,
    delayMin: c.delayMin,
    delayMax: c.delayMax,
    maxConcurrent: c.maxConcurrent,
    t2iPattern: c.t2iPattern,
  };
}
export async function diagnoseGlabs(config, apiKey, fetcher = fetch) {
  const testedUrl = workerIdentity(config.baseUrl) + "api/health",
    checkedAt = new Date().toISOString();
  try {
    const response = await fetcher(testedUrl, {
      method: "GET",
      headers: apiKey ? { "X-API-Key": apiKey } : {},
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok)
      return {
        ok: false,
        testedUrl,
        checkedAt,
        message: "Health worker merespons HTTP " + response.status,
      };
    return {
      ok: true,
      testedUrl,
      checkedAt,
      message:
        "Health worker merespons. Model dan proses generasi belum diuji.",
    };
  } catch {
    return {
      ok: false,
      testedUrl,
      checkedAt,
      message: "Worker tidak dapat dihubungi dalam batas waktu pemeriksaan.",
    };
  }
}
