import assert from "node:assert/strict";
const origin = "http://127.0.0.1:3100";
let cookie = "";
async function request(
  path,
  body,
  { authenticated = true, originHeader = true } = {},
) {
  const headers = {};
  if (authenticated && cookie) headers.Cookie = cookie;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    if (originHeader) headers.Origin = origin;
    headers["Idempotency-Key"] = "smoke-" + crypto.randomUUID();
  }
  const r = await fetch(origin + "/api/v3/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: r.status,
    value: await r.json(),
    cookie: r.headers.get("set-cookie"),
  };
}
const unauthorized = await request("catalog/brand", undefined, {
  authenticated: false,
});
assert.equal(unauthorized.status, 401);
const login = await request("login", {
  tenantId: process.env.TARGET_TENANT_ID,
  username: process.env.CF_ADMIN_USERNAME,
  password: process.env.CF_ADMIN_PASSWORD,
});
assert.equal(login.status, 200);
cookie = login.cookie.split(";")[0];
const summary = {};
for (const domain of [
  "brand",
  "product",
  "deconstruct",
  "preset",
  "visual_identity",
]) {
  const result = await request("catalog/" + domain);
  assert.equal(result.status, 200);
  summary[domain] = result.value.data.length;
  assert.ok(!JSON.stringify(result.value).includes("secret_ciphertext"));
}
for (const endpoint of [
  "me",
  "routines",
  "items",
  "history",
  "connections",
  "accounts",
  "notifications",
  "telegram/bots",
  "catalog-jobs",
  "settings/pool",
  "settings/providers",
  "google/status",
])
  assert.equal((await request(endpoint)).status, 200, endpoint);
assert.equal(
  (await request("routines", {}, { originHeader: false })).status,
  403,
);
assert.equal((await request("catalog/unsupported")).status, 400);

if (process.argv.includes("--mutate")) {
  let brand, product;
  try {
    const created = await request("catalog", {
      domain: "brand",
      name: "CF smoke disposable " + crypto.randomUUID(),
      payload: {},
    });
    assert.equal(created.status, 200);
    brand = created.value.data;
    const p = await request("catalog", {
      domain: "product",
      brandId: brand.id,
      name: "CF smoke test product",
      payload: {
        raw_description:
          "Deskripsi sumber uji lokal, tidak memanggil provider.",
      },
    });
    assert.equal(p.status, 200);
    product = p.value.data;
    const fixture = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJXkAAAAASUVORK5CYII=",
      "base64",
    );
    const form = new FormData();
    form.set("objectId", product.id);
    form.set("expectedRevision", String(product.revision));
    form.set("file", new File([fixture], "smoke.png", { type: "image/png" }));
    const upload = await fetch(origin + "/api/v3/upload", {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie },
      body: form,
    });
    const j = await upload.json();
    assert.equal(upload.status, 200);
    product = j.data;
    assert.equal(product.payload.photo_status, "needs_review");
    const ref = product.payload.photoArtifactId;
    const asset = await fetch(
      origin +
        "/api/v3/media/" +
        process.env.TARGET_TENANT_ID +
        "/" +
        ref.assetId,
      { headers: { Cookie: cookie } },
    );
    assert.equal(asset.status, 200);
    assert.equal((await asset.arrayBuffer()).byteLength, fixture.length);
    const input = {
      id: product.id,
      domain: "product",
      brandId: brand.id,
      name: product.name,
      expectedRevision: product.revision,
      payload: product.payload,
    };
    const edits = await Promise.all([
      request("catalog", input),
      request("catalog", input),
    ]);
    assert.deepEqual(edits.map((e) => e.status).sort(), [200, 409]);
    product = edits.find((e) => e.status === 200).value.data;
    const approval = await request("catalog/" + product.id + "/approve-photo", {
      revision: product.revision,
    });
    assert.equal(approval.status, 200);
    product = approval.value.data;
    assert.equal(product.payload.photo_status, "approved");
  } finally {
    for (const [domain, object] of [
      ["product", product],
      ["brand", brand],
    ])
      if (object) {
        const list = await request("catalog/" + domain);
        const current = list.value.data.find((x) => x.id === object.id);
        if (current)
          assert.equal(
            (
              await request("catalog/" + object.id + "/archive", {
                expectedRevision: current.revision,
              })
            ).status,
            200,
          );
      }
  }
}
assert.equal((await request("logout", {})).status, 200);
assert.equal((await request("me")).status, 401);
console.log(
  JSON.stringify({
    httpSmoke: "passed",
    sourceWrites: 0,
    mutationSmoke: process.argv.includes("--mutate"),
    providerCalls: 0,
    catalogCounts: summary,
  }),
);
