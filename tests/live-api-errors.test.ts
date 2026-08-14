import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  api,
  LiveApiError,
  isRetryableLiveApiError,
} from "../app/live-api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function errorResponse(status: number): Response {
  return new Response(JSON.stringify({ detail: `status ${status}` }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("does not classify client and business errors as fallback eligible", async () => {
  for (const status of [400, 403, 409, 413, 429]) {
    globalThis.fetch = async () => errorResponse(status);
    await assert.rejects(api.assistantStatus(), (reason: unknown) => {
      assert.ok(reason instanceof LiveApiError);
      assert.equal(reason.status, status);
      assert.equal(isRetryableLiveApiError(reason), false);
      return true;
    });
  }
});

test("classifies only gateway availability errors as fallback eligible", async () => {
  for (const status of [502, 503, 504]) {
    globalThis.fetch = async () => errorResponse(status);
    await assert.rejects(api.assistantStatus(), (reason: unknown) => {
      assert.ok(reason instanceof LiveApiError);
      assert.equal(reason.status, status);
      assert.equal(isRetryableLiveApiError(reason), true);
      return true;
    });
  }
});

test("classifies a network failure as fallback eligible", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("network unavailable");
  };
  await assert.rejects(api.assistantStatus(), (reason: unknown) => {
    assert.ok(reason instanceof LiveApiError);
    assert.equal(reason.status, null);
    assert.equal(isRetryableLiveApiError(reason), true);
    return true;
  });
});
