import assert from "node:assert/strict";
import test from "node:test";

import { api } from "../app/live-api";


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
