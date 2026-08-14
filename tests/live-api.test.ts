import assert from "node:assert/strict";
import test from "node:test";

import { api } from "../app/live-api";
import { bridgeMatchesEmbeddedRelease } from "../app/hybrid-api";


test("live client uses the shared versioned API instead of packaged calculations", async () => {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    calls.push({
      path,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (path === "/api/v1/bootstrap") {
      return Response.json({ dataset: { question_count: 201 } });
    }
    return Response.json({ query: "q99", total: 3, questions: [] });
  };
  try {
    const bootstrap = await api.bootstrap();
    assert.equal(bootstrap.dataset.question_count, 201);
    await api.catalogSearch("q99", 7);
    assert.deepEqual(calls, [
      { path: "/api/v1/bootstrap", method: "GET", body: null },
      {
        path: "/api/v1/catalog/search",
        method: "POST",
        body: { query: "q99", limit: 7 },
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("V8.2 bridge is accepted only for the exact embedded ACTIVE data release", () => {
  const embedded = {
    dataset_id: "abs-w1-w6-cloud-aggregate",
    builder_version: "merged-only-5",
    engine_version: "sites-aggregate-v2",
    source_rows: 118_961,
    question_count: 199,
    release_transaction: "mdv4-20260728T124437Z-cd56b81e1294",
    release_correction: "merged-data-v4-resolved.4.0.0",
    release_fingerprint: "c9578ce15fe901aa4ff7ed927cdf1d4cf76cacf10ac858b5f646a933c0fa1ef1",
  };
  const exact = {
    status: "ready",
    release: {
      data_release: "merged-data-v4-resolved.4.0.0",
      data_transaction: "mdv4-20260728T124437Z-cd56b81e1294",
      data_fingerprint: "c9578ce15fe9",
      model_release: "v8.2-iter-250",
    },
  };
  assert.equal(bridgeMatchesEmbeddedRelease(exact, embedded), true);
  assert.equal(
    bridgeMatchesEmbeddedRelease({
      ...exact,
      release: { ...exact.release, data_transaction: "stale-release" },
    }, embedded),
    false,
  );
  assert.equal(
    bridgeMatchesEmbeddedRelease({
      ...exact,
      release: { ...exact.release, model_release: "v7.2-iter-11000" },
    }, embedded),
    false,
  );
});
