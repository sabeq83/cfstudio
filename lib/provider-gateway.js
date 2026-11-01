import { modelChain, modelConfig } from "./gemini-models.js";
import { cachedPrompt, invalidateCache } from "./gemini-cache.js";
import { executePool } from "./gemini-pool.js";
import { StudioError } from "./errors.js";
export function requireDispatch(kind) {
  const flag = {
    production: "ENABLE_PRODUCTION_DISPATCH",
    publishing: "ENABLE_PUBLISHING_DISPATCH",
    telegram: "ENABLE_TELEGRAM_DISPATCH",
  }[kind];
  if (process.env[flag] !== "true")
    throw new StudioError(
      "DISPATCH_DISABLED",
      "Dispatch " + kind + " belum diaktifkan.",
      503,
    );
}
export class ProviderGateway {
  constructor({ fetcher = fetch } = {}) {
    this.fetch = fetcher;
  }
  async json(
    connection,
    method,
    path,
    body,
    {
      dispatch = "production",
      readOnly = false,
      configurationTest = false,
    } = {},
  ) {
    if (!readOnly && !configurationTest) requireDispatch(dispatch);
    const base = connection.config.baseUrl;
    if (!base)
      throw new StudioError("ENDPOINT_REQUIRED", "Endpoint provider wajib.");
    const url = new URL(path, base.endsWith("/") ? base : base + "/");
    const headers = { "Content-Type": "application/json" };
    if (connection.kind === "glabs")
      headers["X-API-Key"] = connection.secret.apiKey || "";
    else if (connection.kind === "repliz")
      headers.Authorization =
        "Basic " +
        Buffer.from(
          `${connection.secret.accessKey}:${connection.secret.secretKey}`,
        ).toString("base64");
    else headers.Authorization = "Bearer " + (connection.secret.apiKey || "");
    let response;
    try {
      response = await this.fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(120000),
        redirect: "error",
      });
    } catch {
      throw new StudioError(
        method === "GET" ? "PROVIDER_UNAVAILABLE" : "PROVIDER_OUTCOME_UNKNOWN",
        "Provider tidak memberi respons yang dapat dipastikan.",
        503,
      );
    }
    if (!response.ok) {
      const code =
        response.status === 401 || response.status === 403
          ? "PROVIDER_AUTH_FAILED"
          : response.status === 429
            ? "PROVIDER_RATE_LIMIT"
            : response.status >= 500
              ? method === "GET"
                ? "PROVIDER_UNAVAILABLE"
                : "PROVIDER_OUTCOME_UNKNOWN"
              : "PROVIDER_REQUEST_REJECTED";
      throw new StudioError(
        code,
        "Provider menolak permintaan (" + response.status + ").",
        502,
      );
    }
    if (response.status === 204) return {};
    try {
      return await response.json();
    } catch {
      throw new StudioError(
        "PROVIDER_INVALID_RESPONSE",
        "Respons provider tidak valid.",
        502,
      );
    }
  }
  async gemini(connection, prompt, options = {}) {
    requireDispatch("production");
    const chain = options.audio
      ? [
          options.model ||
            connection.config.ttsModel ||
            "gemini-2.5-flash-preview-tts",
        ]
      : options.model
        ? [options.model]
        : modelChain(connection.config, options.module || "campaign");
    let last;
    for (let i = 0; i < chain.length; i++) {
      const model = chain[i];
      try {
        const perform = (c) =>
          this.geminiSingle(
            {
              ...c,
              config: {
                ...c.config,
                ...modelConfig(connection.config),
                ttsModel: connection.config.ttsModel || c.config.ttsModel,
              },
            },
            prompt,
            { ...options, model },
          );
        if (connection.tenant_id) {
          const pooled = await executePool(
            connection.tenant_id,
            model,
            perform,
          );
          if (pooled.handled) return pooled.result;
        }
        return await perform(connection);
      } catch (error) {
        last = error;
        if (
          !["GEMINI_MODEL_UNAVAILABLE", "GEMINI_MODEL_BUSY"].includes(
            error.code,
          ) ||
          i === chain.length - 1
        )
          throw error;
        if (error.code === "GEMINI_MODEL_BUSY")
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(2000, 250 * 2 ** i)),
          );
      }
    }
    throw last;
  }
  async geminiSingle(
    connection,
    prompt,
    {
      audio = false,
      voice = "Puck",
      parts: inputParts = [],
      model: modelOverride,
      skipCache = false,
    } = {},
  ) {
    requireDispatch("production");
    const model =
      modelOverride ||
      (audio
        ? connection.config.ttsModel || "gemini-2.5-flash-preview-tts"
        : connection.config.model);
    if (!model)
      throw new StudioError(
        "MODEL_REQUIRED",
        "Model Gemini wajib dipilih pada koneksi.",
      );
    const url = new URL(
      `v1beta/models/${encodeURIComponent(model)}:generateContent`,
      connection.config.baseUrl || "https://generativelanguage.googleapis.com/",
    );
    const cacheName =
      !audio && !inputParts.length && !skipCache
        ? await cachedPrompt(connection, model, prompt, this.fetch)
        : null;
    let response;
    try {
      response = await this.fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": connection.secret.apiKey,
        },
        body: JSON.stringify({
          ...(cacheName ? { cachedContent: cacheName } : {}),
          contents: [
            {
              parts: [
                {
                  text: cacheName
                    ? "Execute the complete cached request and return the requested JSON output."
                    : prompt,
                },
                ...inputParts,
              ],
            },
          ],
          generationConfig: audio
            ? {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
                },
              }
            : { responseMimeType: "application/json", maxOutputTokens: 32768 },
        }),
        signal: AbortSignal.timeout(180000),
        redirect: "error",
      });
    } catch {
      throw new StudioError(
        "PROVIDER_OUTCOME_UNKNOWN",
        "Hasil permintaan Gemini belum dapat dipastikan.",
        503,
      );
    }
    if (!response.ok) {
      let info = {};
      try {
        info = await response.json();
      } catch {}
      if (cacheName && [400, 404].includes(response.status)) {
        await invalidateCache(connection, cacheName);
        return this.geminiSingle(connection, prompt, {
          audio,
          voice,
          parts: inputParts,
          model: modelOverride,
          skipCache: true,
        });
      }
      const details = JSON.stringify(info.error?.details || []);
      const code =
        response.status === 401 || details.includes("API_KEY_INVALID")
          ? "GEMINI_KEY_INVALID"
          : response.status === 404
            ? "GEMINI_MODEL_UNAVAILABLE"
            : response.status === 503 && info.error?.status === "UNAVAILABLE"
              ? "GEMINI_MODEL_BUSY"
              : response.status === 403
                ? "PROVIDER_PERMISSION_DENIED"
                : response.status === 429
                  ? /requestsperday|per_day|perday/i.test(details)
                    ? "GEMINI_QUOTA_EXHAUSTED"
                    : "PROVIDER_RATE_LIMIT"
                  : response.status >= 500
                    ? "PROVIDER_OUTCOME_UNKNOWN"
                    : "PROVIDER_REQUEST_REJECTED";
      throw new StudioError(
        code,
        "Gemini belum berhasil memproses permintaan.",
        502,
      );
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new StudioError(
        "PROVIDER_OUTCOME_UNKNOWN",
        "Respons Gemini terputus setelah permintaan diterima.",
        503,
      );
    }
    const parts = data.candidates?.[0]?.content?.parts || [];
    if (audio) {
      const a = parts.find((p) => p.inlineData)?.inlineData;
      if (!a?.data)
        throw new StudioError("AUDIO_RESPONSE_EMPTY", "Audio provider kosong.");
      return { buffer: Buffer.from(a.data, "base64"), mime: a.mimeType };
    }
    const text = parts.map((p) => p.text || "").join("");
    try {
      return JSON.parse(
        text.trim().startsWith("```")
          ? text
              .trim()
              .split(String.fromCharCode(10))
              .slice(1, -1)
              .join(String.fromCharCode(10))
          : text,
      );
    } catch {
      throw new StudioError(
        "CREATIVE_JSON_INVALID",
        "Materi kreatif AI belum valid.",
      );
    }
  }
  async download(url, connection) {
    const target = new URL(url),
      origin = new URL(connection.config.baseUrl);
    const hosts = (process.env.CF_MEDIA_ALLOWED_HOSTS || "")
      .split(",")
      .filter(Boolean);
    if (target.origin !== origin.origin && !hosts.includes(target.hostname))
      throw new StudioError("MEDIA_HOST_DENIED", "Host media belum diizinkan.");
    const response = await this.fetch(target, {
      signal: AbortSignal.timeout(60000),
      redirect: "error",
    });
    if (!response.ok)
      throw new StudioError(
        "MEDIA_DOWNLOAD_FAILED",
        "Media provider belum dapat diambil.",
      );
    const limit = 200 * 1024 * 1024;
    if (Number(response.headers.get("content-length") || 0) > limit)
      throw new StudioError("MEDIA_TOO_LARGE", "Media melampaui batas.");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > limit)
      throw new StudioError("MEDIA_TOO_LARGE", "Media melampaui batas.");
    return {
      buffer,
      mime: response.headers.get("content-type") || "application/octet-stream",
    };
  }
}
export const gateway = new ProviderGateway();
export function pcmToWav(pcm, sampleRate = 24000) {
  const h = Buffer.alloc(44);
  h.write("RIFF");
  h.writeUInt32LE(pcm.length + 36, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
