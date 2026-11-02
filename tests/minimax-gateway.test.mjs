import test from "node:test";
import assert from "node:assert/strict";
import {
  minimaxTts,
  MINIMAX_ENDPOINTS,
  mayFallbackMinimax,
} from "../lib/minimax-gateway.js";
import { ProviderGateway } from "../lib/provider-gateway.js";
const connection = {
  kind: "minimax",
  config: { baseUrl: "https://should-not-receive-key.example.test/" },
  secret: { apiKey: "TEST_MOCK_MINIMAX_KEY" },
};
const body = {
  model: "speech-2.8-turbo",
  text: "Hello",
  stream: false,
  voice_setting: { voice_id: "preset-voice", speed: 1, vol: 1 },
  audio_setting: { format: "mp3" },
  output_format: "hex",
};
const json = (v, status = 200) => new Response(JSON.stringify(v), { status });
const success = () =>
  json({
    base_resp: { status_code: 0 },
    data: { audio: "4944330000", status: 2 },
  });
const options = (fetcher) => ({ fetcher, wait: async () => {} });
test("MiniMax rotates in V2 endpoint order after explicit internal rejection, preserving key and preset payload", async () => {
  const calls = [];
  const result = await minimaxTts(
    connection,
    body,
    options(async (url, o) => {
      calls.push(url);
      assert.equal(o.redirect, "error");
      assert.equal(o.headers.Authorization, "Bearer TEST_MOCK_MINIMAX_KEY");
      assert.deepEqual(JSON.parse(o.body), body);
      return calls.length === 1
        ? json({ base_resp: { status_code: 1024 } }, 503)
        : success();
    }),
  );
  assert.equal(result.data.audio, "4944330000");
  assert.deepEqual(calls, MINIMAX_ENDPOINTS.slice(0, 2));
});
test("MiniMax all safe gateway rejections stop after four endpoints", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      minimaxTts(
        connection,
        body,
        options(async () => {
          calls++;
          return json({ base_resp: { status_code: 2064 } }, 503);
        }),
      ),
    { code: "MINIMAX_ENDPOINTS_UNAVAILABLE" },
  );
  assert.equal(calls, 4);
});
test("MiniMax known pre-connect failure may rotate; socket loss after dispatch may not", async () => {
  let calls = 0;
  await minimaxTts(
    connection,
    body,
    options(async () => {
      calls++;
      if (calls === 1)
        throw Object.assign(new Error("connect"), {
          cause: { code: "ECONNREFUSED" },
        });
      return success();
    }),
  );
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(
    () =>
      minimaxTts(
        connection,
        body,
        options(async () => {
          calls++;
          throw Object.assign(new Error("lost"), {
            cause: { code: "ECONNRESET" },
          });
        }),
      ),
    { code: "PROVIDER_OUTCOME_UNKNOWN" },
  );
  assert.equal(calls, 1);
});
test("MiniMax authentication, balance and input rejections never rotate or fall back to Gemini", async () => {
  for (const [n, code] of [
    [1004, "PROVIDER_AUTH_FAILED"],
    [2049, "PROVIDER_AUTH_FAILED"],
    [1008, "MINIMAX_BALANCE_REQUIRED"],
    [2056, "MINIMAX_BALANCE_REQUIRED"],
    [2013, "MINIMAX_REQUEST_REJECTED"],
    [20132, "MINIMAX_REQUEST_REJECTED"],
  ]) {
    let calls = 0;
    await assert.rejects(
      () =>
        minimaxTts(
          connection,
          body,
          options(async () => {
            calls++;
            return json({
              base_resp: { status_code: n, status_msg: "TEST_MOCK_MESSAGE" },
            });
          }),
        ),
      (e) => {
        assert.equal(e.code, code);
        assert.equal(mayFallbackMinimax(e), false);
        assert.ok(!e.message.includes("TEST_MOCK_MESSAGE"));
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});
test("MiniMax rate limit returns to scheduler rather than rotating keys/endpoints", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      minimaxTts(
        connection,
        body,
        options(async () => {
          calls++;
          return json({ base_resp: { status_code: 1002 } }, 429);
        }),
      ),
    { code: "PROVIDER_RATE_LIMIT" },
  );
  assert.equal(calls, 1);
});
test("MiniMax timeout, non-JSON success, partial/invalid audio and unstructured 5xx remain unknown", async () => {
  const responses = [
    () => {
      throw new Error("timeout");
    },
    () => new Response("html", { status: 200 }),
    () => json({ base_resp: { status_code: 0 }, data: { audio: "invalid" } }),
    () => json({ base_resp: { status_code: 0 }, data: { audio: "abc" } }),
    () =>
      json({
        base_resp: { status_code: 0 },
        data: { audio: "494433", status: 1 },
      }),
    () => json({}, 503),
    () => json({ base_resp: { status_code: 1001 } }),
    () => json({ base_resp: { status_code: 0 }, data: {} }),
  ];
  for (const response of responses) {
    let calls = 0;
    await assert.rejects(
      () =>
        minimaxTts(
          connection,
          body,
          options(async () => {
            calls++;
            return response();
          }),
        ),
      (e) => {
        assert.equal(e.code, "PROVIDER_OUTCOME_UNKNOWN");
        assert.equal(mayFallbackMinimax(e), false);
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});
test("MiniMax redirects are not followed and missing routes can fail over", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      minimaxTts(
        connection,
        body,
        options(async () => {
          calls++;
          return new Response(null, {
            status: 302,
            headers: { Location: "https://untrusted.example.test/" },
          });
        }),
      ),
    { code: "PROVIDER_OUTCOME_UNKNOWN" },
  );
  assert.equal(calls, 1);
  calls = 0;
  await minimaxTts(
    connection,
    body,
    options(async () =>
      ++calls === 1 ? new Response("not found", { status: 404 }) : success(),
    ),
  );
  assert.equal(calls, 2);
});
test("MiniMax production dispatch gate covers managed rotation before HTTP; explicit admin voice diagnostic uses same executor", async () => {
  process.env.ENABLE_PRODUCTION_DISPATCH = "false";
  let calls = 0;
  const g = new ProviderGateway({
    fetcher: async () => {
      calls++;
      return success();
    },
  });
  await assert.rejects(() => g.json(connection, "POST", "v1/t2a_v2", body), {
    code: "DISPATCH_DISABLED",
  });
  assert.equal(calls, 0);
  await g.json(connection, "POST", "v1/t2a_v2", body, {
    configurationTest: true,
  });
  assert.equal(calls, 1);
});
