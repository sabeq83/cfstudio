import { StudioError } from "./errors.js";
// Fixed endpoint order adopted from the V2 MiniMax TTS gateway pool.
// Never accept a caller-provided host or forward redirects with the bearer key.
export const MINIMAX_ENDPOINTS = Object.freeze([
  "https://api.minimax.io/v1/t2a_v2",
  "https://api.minimaxi.chat/v1/t2a_v2",
  "https://api.minimax.chat/v1/t2a_v2",
  "https://api-uw.minimax.io/v1/t2a_v2",
]);
const AUTH = new Set([1004, 2049, 2057]);
const BALANCE = new Set([1008, 2053, 2056, 2067]);
const BUSY = new Set([1024, 1033, 2064]);
const RATE = new Set([1002, 1039, 1041, 1045, 2045, 2046, 2047, 2062]);
function failure(code) {
  return new StudioError(
    code,
    {
      PROVIDER_AUTH_FAILED:
        "MiniMax menolak API key. Periksa key pada Settings.",
      MINIMAX_BALANCE_REQUIRED: "Saldo atau kuota MiniMax tidak mencukupi.",
      PROVIDER_RATE_LIMIT:
        "MiniMax membatasi permintaan. Tunggu sebelum mencoba lagi.",
      MINIMAX_REQUEST_REJECTED:
        "MiniMax menolak parameter, model, suara atau konten. Periksa preset.",
      PROVIDER_OUTCOME_UNKNOWN:
        "Hasil permintaan MiniMax belum pasti. Perlu rekonsiliasi sebelum membuat ulang.",
      MINIMAX_ENDPOINTS_UNAVAILABLE:
        "Seluruh endpoint MiniMax belum siap memproses permintaan.",
    }[code],
    code === "PROVIDER_AUTH_FAILED" ? 401 : 503,
  );
}
export function mayFallbackMinimax(error) {
  return [
    "MINIMAX_ENDPOINTS_UNAVAILABLE",
    "PROVIDER_RATE_LIMIT",
    "PROVIDER_UNAVAILABLE",
  ].includes(error.code);
}
export async function minimaxTts(
  connection,
  body,
  {
    fetcher = fetch,
    wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = {},
) {
  if (!connection.secret?.apiKey) throw failure("PROVIDER_AUTH_FAILED");
  // Only synchronous hex audio is supported by the shared durable TTS pipeline.
  if (!body || body.stream === true || body.output_format !== "hex")
    throw failure("MINIMAX_REQUEST_REJECTED");
  for (let i = 0; i < MINIMAX_ENDPOINTS.length; i++) {
    let r;
    try {
      r = await fetcher(MINIMAX_ENDPOINTS[i], {
        method: "POST",
        headers: {
          Authorization: "Bearer " + connection.secret.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
        redirect: "error",
      });
    } catch (error) {
      if (
        [
          "ENOTFOUND",
          "EAI_AGAIN",
          "ECONNREFUSED",
          "UND_ERR_CONNECT_TIMEOUT",
        ].includes(error?.cause?.code)
      ) {
        if (i < MINIMAX_ENDPOINTS.length - 1) {
          await wait(250 * (i + 1));
          continue;
        }
        throw failure("MINIMAX_ENDPOINTS_UNAVAILABLE");
      }
      throw failure("PROVIDER_OUTCOME_UNKNOWN");
    }
    let value = null;
    try {
      value = await r.json();
    } catch {}
    const raw = value?.base_resp?.status_code,
      code = raw === undefined || raw === null ? null : Number(raw);
    const audio = value?.data?.audio;
    if (AUTH.has(code) || [401, 403].includes(r.status))
      throw failure("PROVIDER_AUTH_FAILED");
    if (BALANCE.has(code) || r.status === 402)
      throw failure("MINIMAX_BALANCE_REQUIRED");
    // Even an error response containing audio could represent a completed/charged generation.
    if (audio && (!r.ok || code !== 0))
      throw failure("PROVIDER_OUTCOME_UNKNOWN");
    if (r.ok && code === 0) {
      if (value.data?.status !== undefined && Number(value.data.status) !== 2)
        throw failure("PROVIDER_OUTCOME_UNKNOWN");
      if (
        typeof audio !== "string" ||
        audio.length < 2 ||
        audio.length % 2 ||
        !/^[0-9a-f]+$/i.test(audio)
      )
        throw failure("PROVIDER_OUTCOME_UNKNOWN");
      return value;
    }
    if (RATE.has(code) || r.status === 429)
      throw failure("PROVIDER_RATE_LIMIT");
    const safeRejection = BUSY.has(code) && !audio;
    const missingEndpoint =
      [404, 405].includes(r.status) && !audio && code === null;
    if (safeRejection || missingEndpoint) {
      if (i < MINIMAX_ENDPOINTS.length - 1) {
        await wait(250 * (i + 1));
        continue;
      }
      throw failure("MINIMAX_ENDPOINTS_UNAVAILABLE");
    }
    if (
      [1000, 1001, 2066].includes(code) ||
      r.status >= 500 ||
      !value ||
      code === null
    )
      throw failure("PROVIDER_OUTCOME_UNKNOWN");
    throw failure("MINIMAX_REQUEST_REJECTED");
  }
  throw failure("MINIMAX_ENDPOINTS_UNAVAILABLE");
}
