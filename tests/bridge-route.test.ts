import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

test("Sites bridge accepts the opaque underscore conversation IDs emitted by V8.2", async () => {
  const originalFetch = globalThis.fetch;
  const originalOrigin = process.env.SURVEY_LIVE_API_ORIGIN;
  const originalToken = process.env.SURVEY_LIVE_API_TOKEN;
  let upstreamPath = "";
  process.env.SURVEY_LIVE_API_ORIGIN = "https://gateway.example";
  process.env.SURVEY_LIVE_API_TOKEN = "test-token";
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    upstreamPath = new URL(request.url).pathname;
    assert.equal(request.headers.get("authorization"), "Bearer test-token");
    return Response.json({ status: "answered" });
  };

  try {
    const { POST } = await import("../app/api/v1/[...path]/route");
    const response = await POST(new NextRequest(
      "https://survey.example/api/v1/conversations/conv_123/messages",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "q96" }),
      },
    ));
    assert.equal(response.status, 200);
    assert.equal(upstreamPath, "/api/v1/conversations/conv_123/messages");
    assert.equal(response.headers.get("x-survey-model-path"), "local-v8.2-2b");
    assert.equal(response.headers.get("x-survey-channel"), "sites-gateway-8511");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOrigin === undefined) delete process.env.SURVEY_LIVE_API_ORIGIN;
    else process.env.SURVEY_LIVE_API_ORIGIN = originalOrigin;
    if (originalToken === undefined) delete process.env.SURVEY_LIVE_API_TOKEN;
    else process.env.SURVEY_LIVE_API_TOKEN = originalToken;
  }
});
