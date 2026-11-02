import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeGlabsConfig,
  workerIdentity,
  diagnoseGlabs,
} from "../lib/glabs-settings.js";
test("G-Labs V2 defaults, custom/HTTPS preservation and canonical worker", () => {
  const c = normalizeGlabsConfig({ host: "WORKER.example.test", port: 8765 });
  assert.equal(c.baseUrl, "http://worker.example.test:8765/");
  assert.equal(c.imageModel, "nano_banana_pro");
  assert.equal(c.videoModel, "veo_31_lite_relaxed");
  const old = normalizeGlabsConfig(
    { delayEnabled: false },
    {
      baseUrl: "https://worker.example.test:443/",
      imageModel: "custom-image",
      videoModel: "custom-video",
    },
  );
  assert.equal(old.baseUrl, "https://worker.example.test/");
  assert.equal(old.imageModel, "custom-image");
  assert.equal(old.delayMin, 10);
  assert.equal(
    workerIdentity("HTTP://WORKER.example.test:80"),
    "http://worker.example.test/",
  );
});
test("G-Labs rejects malformed endpoint and noninteger/NaN/inverted delay", () => {
  for (const input of [
    { delayMax: "abc" },
    { delayMin: 1.5 },
    { delayMin: 30, delayMax: 20 },
    { maxConcurrent: 0 },
    { delayMax: null },
    { port: 65536, host: "worker" },
    { host: "worker/path" },
    { baseUrl: "http://user:pass@worker/" },
    { baseUrl: "http://worker/path" },
    { baseUrl: "http://worker/?secret=x" },
  ])
    assert.throws(
      () => normalizeGlabsConfig({ baseUrl: "http://worker/", ...input }),
      { code: "GLABS_SETTING_INVALID" },
    );
});
test("draft diagnostic is GET-only, bounded, no redirects and redacts response/errors", async () => {
  const calls = [];
  const r = await diagnoseGlabs(
    { baseUrl: "http://worker:8765/" },
    "TEST_MOCK_KEY",
    async (url, opts) => {
      calls.push({ url, opts });
      return new Response("sensitive provider output", { status: 200 });
    },
  );
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://worker:8765/api/health");
  assert.equal(calls[0].opts.method, "GET");
  assert.equal(calls[0].opts.body, undefined);
  assert.equal(calls[0].opts.redirect, "error");
  assert.ok(calls[0].opts.signal);
  assert.ok(!JSON.stringify(r).includes("TEST_MOCK"));
  const failed = await diagnoseGlabs(
    { baseUrl: "http://worker/" },
    "TEST_MOCK",
    async () => {
      throw Error("secret output");
    },
  );
  assert.equal(failed.ok, false);
  assert.ok(!JSON.stringify(failed).includes("secret output"));
});
