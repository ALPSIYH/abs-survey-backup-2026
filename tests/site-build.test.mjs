import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("https://survey.example/", {
      headers: {
        accept: "text/html",
        host: "survey.example",
        "x-forwarded-host": "survey.example",
        "x-forwarded-proto": "https",
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the finished survey explorer", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Asian Barometer Survey Explorer<\/title>/i);
  assert.match(html, /https:\/\/survey\.example\/og\.png/);
  assert.match(html, /mdv4-20260728T124437Z-cd56b81e1294/);
  assert.doesNotMatch(html, /Loading questions|載入題目/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|SkeletonPreview/);
});

test("packages the independent static first screen into Cloudflare assets", async () => {
  const [html, wranglerText] = await Promise.all([
    readFile(new URL("../dist/client/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/server/wrangler.json", import.meta.url), "utf8"),
  ]);
  const wrangler = JSON.parse(wranglerText);
  assert.match(html, /Asian Barometer Survey Explorer/u);
  assert.match(html, /<script[^>]+src="\.\/assets\//u);
  assert.equal(wrangler.assets?.binding, "ASSETS");
  assert.equal(wrangler.assets?.run_worker_first, true);
});

test("presents generic local and cloud runtime status", async () => {
  const source = await readFile(new URL("../app/App.tsx", import.meta.url), "utf8");
  assert.match(source, /Checking connection…/u);
  assert.match(source, /Local model connected/u);
  assert.match(source, /Cloud API \(local unavailable; no access to the local database or respondent-level records\)/u);
  assert.match(source, /云端 API（本地未连接；无法访问本机数据库或受访者级记录）/u);
  assert.doesNotMatch(source, /Local V8\.2 primary connected · DeepSeek fallback ready/u);
});

test("continues an interrupted local conversation in sticky cloud mode", async () => {
  const app = await readFile(new URL("../app/App.tsx", import.meta.url), "utf8");
  const hybrid = await readFile(new URL("../app/hybrid-api.ts", import.meta.url), "utf8");
  assert.match(app, /response\.execution_mode/u);
  assert.match(hybrid, /conversationRoutes/u);
  assert.match(hybrid, /conversationMirrors/u);
  assert.match(hybrid, /staticApi\.importConversation\(mirror\)/u);
  assert.match(hybrid, /conversationRoutes\.set\(conversationId, "cloud"\)/u);
  assert.match(hybrid, /confirmBridgeUnavailable/u);
  assert.match(hybrid, /BRIDGE_CONFIRMATION_ATTEMPTS = 2/u);
  assert.doesNotMatch(hybrid, /LocalConversationUnavailableError/u);
});

test("only retryable local service failures can use a fallback", async () => {
  const live = await readFile(new URL("../app/live-api.ts", import.meta.url), "utf8");
  const hybrid = await readFile(new URL("../app/hybrid-api.ts", import.meta.url), "utf8");
  assert.match(live, /new Set\(\[502, 503, 504\]\)/u);
  assert.match(hybrid, /isRetryableLiveApiError/u);
});

test("local model operations have a longer bound than health probes", async () => {
  const route = await readFile(
    new URL("../app/api/v1/[...path]/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /HEALTH_TIMEOUT_MS = 5_000/u);
  assert.match(route, /OPERATION_TIMEOUT_MS = 75_000/u);
});

test("public deployment cannot invoke a model without a configured server secret", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("local-route-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("https://survey.example/api/question-rerank", {
      headers: {
        accept: "application/json",
        host: "survey.example",
        "x-forwarded-host": "survey.example",
        "x-forwarded-proto": "https",
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
  assert.equal(response.status, 503);
});

test("primary local bridge fails closed when no durable origin is configured", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("bridge-disabled-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("https://survey.example/api/v1/health", {
      headers: {
        accept: "application/json",
        host: "survey.example",
        "x-forwarded-host": "survey.example",
        "x-forwarded-proto": "https",
      },
    }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 503);
  assert.match((await response.json()).detail, /local survey service is not configured/i);
});

async function requestThroughLocalBinding(status) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("local-status-test", `${process.pid}-${Date.now()}-${status}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("https://survey.example/api/v1/assistant/status", {
      headers: {
        accept: "application/json",
        host: "survey.example",
        "x-forwarded-host": "survey.example",
        "x-forwarded-proto": "https",
      },
    }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      SURVEY_LIVE_API_TOKEN: "test-token",
      SURVEY_V82_API: {
        fetch: async () => Response.json({ detail: `upstream-${status}` }, { status }),
      },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("independent worker preserves non-retryable local errors without model headers", async () => {
  for (const status of [400, 403, 409, 413, 429, 500]) {
    const response = await requestThroughLocalBinding(status);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("x-survey-model-path"), null);
    assert.equal((await response.json()).detail, `upstream-${status}`);
  }
});

test("independent worker falls back only for gateway availability errors", async () => {
  for (const status of [502, 503, 504]) {
    const response = await requestThroughLocalBinding(status);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("x-survey-model-path"), null);
    assert.match((await response.json()).detail, /local survey service is not configured/i);
  }
});

test("independent worker allowlists bridge paths and strips upstream headers", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("bridge-security-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  let calls = 0;
  const env = {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    SURVEY_LIVE_API_TOKEN: "test-token",
    SURVEY_V82_API: {
      fetch: async (request) => {
        calls += 1;
        assert.equal(request.headers.get("authorization"), "Bearer test-token");
        return Response.json(
          { status: "ready" },
          {
            headers: {
              "Set-Cookie": "secret=forbidden",
              "X-Upstream-Internal": "forbidden",
              "Retry-After": "7",
            },
          },
        );
      },
    },
  };
  const context = { waitUntil() {}, passThroughOnException() {} };

  const forbidden = await worker.fetch(
    new Request("https://survey.example/api/v1/private/export", { method: "GET" }),
    env,
    context,
  );
  assert.equal(forbidden.status, 403);
  assert.equal(calls, 0);

  const allowed = await worker.fetch(
    new Request("https://survey.example/api/v1/health", { method: "GET" }),
    env,
    context,
  );
  assert.equal(allowed.status, 200);
  assert.equal(calls, 1);
  assert.equal(allowed.headers.get("x-survey-execution"), "local");
  assert.equal(allowed.headers.get("x-survey-channel"), "backup-local");
  assert.equal(allowed.headers.get("x-survey-model-path"), null);
  assert.equal(allowed.headers.get("set-cookie"), null);
  assert.equal(allowed.headers.get("x-upstream-internal"), null);
  assert.equal(allowed.headers.get("retry-after"), "7");
});

test("packages the complete aggregate-only cloud dataset", async () => {
  const [catalogText, manifestText, questionFiles, responseSetFiles] = await Promise.all([
    readFile(new URL("../public/data/catalog.json", import.meta.url), "utf8"),
    readFile(new URL("../public/data/manifest.json", import.meta.url), "utf8"),
    readdir(new URL("../public/data/questions/", import.meta.url)),
    readdir(new URL("../public/data/response-sets/", import.meta.url)),
  ]);
  const catalog = JSON.parse(catalogText);
  const manifest = JSON.parse(manifestText);
  assert.equal(catalog.dataset.questionCount, 201);
  assert.equal(catalog.dataset.sourceRows, 118_961);
  assert.equal(catalog.dataset.dataMode, "aggregate-only");
  assert.equal(catalog.dataset.builderVersion, "merged-only-5");
  assert.equal(
    catalog.dataset.release.transactionId,
    "mdv4-20260728T124437Z-cd56b81e1294",
  );
  assert.equal(
    catalog.dataset.release.sourceDatabase.sha256,
    "c9578ce15fe901aa4ff7ed927cdf1d4cf76cacf10ac858b5f646a933c0fa1ef1",
  );
  assert.equal(catalog.questions.length, 201);
  assert.equal(catalog.countries.length, 18);
  assert.deepEqual(
    catalog.countries.filter(({ code }) => code === 19 || code === 20),
    [
      { code: 19, name: "Bangladesh" },
      { code: 20, name: "Sri Lanka" },
    ],
  );
  assert.equal(catalog.responseSets.length, 2);
  assert.equal(questionFiles.filter((name) => name.endsWith(".json")).length, 201);
  assert.equal(responseSetFiles.filter((name) => name.endsWith(".json")).length, 2);
  assert.equal(manifest.questionFiles, 201);
  assert.equal(manifest.responseSetFiles, 2);
  assert.equal(manifest.aggregateCells, 81_899);
  assert.equal(manifest.schemaVersion, "sites-static-data-manifest.v2");
  assert.deepEqual(manifest.release, catalog.dataset.release);
  assert.equal(Object.keys(manifest.files).length, 205);

  const observedFiles = {};
  for (const relativePath of Object.keys(manifest.files).sort()) {
    const bytes = await readFile(new URL(`../public/data/${relativePath}`, import.meta.url));
    observedFiles[relativePath] = createHash("sha256").update(bytes).digest("hex");
  }
  assert.deepEqual(observedFiles, manifest.files);
  const contentHash = createHash("sha256");
  for (const [relativePath, digest] of Object.entries(observedFiles).sort(([a], [b]) => a.localeCompare(b))) {
    contentHash.update(`${relativePath}\0${digest}\n`);
  }
  assert.equal(contentHash.digest("hex"), manifest.contentSha256);

  const q95 = JSON.parse(
    await readFile(new URL("../public/data/questions/q95.json", import.meta.url), "utf8"),
  );
  assert.equal(q95.id, "q95");
  assert.ok(q95.scale.length >= 4);
  assert.ok(q95.cells.length > 100);

  const q36 = JSON.parse(
    await readFile(new URL("../public/data/questions/q36.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(
    q36.cells.filter(([country, wave, rawValue]) =>
      country === 9 && wave === 6 && [1, 2].includes(rawValue)),
    [
      [9, 6, 1, 90],
      [9, 6, 2, 1_429],
    ],
  );

  const bundle = JSON.parse(
    await readFile(new URL("../public/data/bundle.json", import.meta.url), "utf8"),
  );
  assert.equal(Object.keys(bundle.questions).length, 201);
  assert.equal(Object.keys(bundle.responseSets).length, 2);
  assert.deepEqual(bundle.questions.q36, q36);
  assert.equal(bundle.questions.q99, undefined);
  assert.deepEqual(
    Object.keys(bundle.questions).filter((id) => id.startsWith("q99")).sort(),
    ["q99_expect_10y", "q99_expect_5y", "q99_want_future"],
  );

  const q76 = bundle.questions.q76;
  assert.equal(q76.cells.some(([, wave]) => wave === 2 || wave === 3), false);
  const q163 = bundle.questions.q163;
  assert.equal(q163.cells.some(([, wave]) => wave === 4), false);

  const membership = JSON.parse(
    await readFile(
      new URL(
        "../public/data/response-sets/organization_membership.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(membership.members.length, 3);
  assert.ok(membership.options.length > 10);
  assert.ok(membership.scopes.any.rows.length > 100);
  assert.deepEqual(
    membership.scopes["3"].contexts.find(([country, wave]) => country === 12 && wave === 3),
    [12, 3, 1_200],
  );
  assert.deepEqual(
    membership.scopes["3"].rows.find(([country, wave, rawValue]) =>
      country === 12 && wave === 3 && rawValue === 7),
    [12, 3, 7, 1_200, 1],
  );
});

test("does not expose respondent-level source files", async () => {
  const publicFiles = await readdir(new URL("../public/", import.meta.url));
  assert.equal(publicFiles.some((name) => /\.(sav|duckdb|parquet|csv)$/i.test(name)), false);
  await assert.rejects(access(new URL("../public/data/responses.json", import.meta.url)));
  try {
    assert.deepEqual(
      await readdir(new URL("../app/_sites-preview/", import.meta.url)),
      [],
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await access(new URL("../public/og.png", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
  const staticHtml = await readFile(new URL("../dist-static/index.html", import.meta.url), "utf8");
  assert.match(staticHtml, /\.\/assets\/index-/);
  assert.match(staticHtml, /name="survey-runtime" content="static-independent"/);
  const hybridSource = await readFile(new URL("../app/hybrid-api.ts", import.meta.url), "utf8");
  assert.doesNotMatch(hybridSource, /document\.querySelector/u);
  assert.match(hybridSource, /window\.fetch\("\/api\/v1\/health"/u);
  await access(new URL("../dist-static/data/catalog.json", import.meta.url));
  await access(new URL("../dist-static/data/bundle.json", import.meta.url));
  await access(new URL("../dist-static/data/questions/q36.json", import.meta.url));
  await access(root);
});
