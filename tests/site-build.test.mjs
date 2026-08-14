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
  const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  assert.match(html, /Asian Barometer Survey Explorer/u);
  assert.match(html, /<script[^>]+src="\.\/assets\//u);
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
  assert.match((await response.json()).detail, /primary local V8\.2 service is not configured/i);
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
  assert.equal(catalog.dataset.questionCount, 199);
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
  assert.equal(catalog.questions.length, 199);
  assert.equal(catalog.countries.length, 18);
  assert.deepEqual(
    catalog.countries.filter(({ code }) => code === 19 || code === 20),
    [
      { code: 19, name: "Bangladesh" },
      { code: 20, name: "Sri Lanka" },
    ],
  );
  assert.equal(catalog.responseSets.length, 2);
  assert.equal(questionFiles.filter((name) => name.endsWith(".json")).length, 199);
  assert.equal(responseSetFiles.filter((name) => name.endsWith(".json")).length, 2);
  assert.equal(manifest.questionFiles, 199);
  assert.equal(manifest.responseSetFiles, 2);
  assert.equal(manifest.aggregateCells, 85_805);
  assert.equal(manifest.schemaVersion, "sites-static-data-manifest.v2");
  assert.deepEqual(manifest.release, catalog.dataset.release);
  assert.equal(Object.keys(manifest.files).length, 203);

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
  assert.equal(Object.keys(bundle.questions).length, 199);
  assert.equal(Object.keys(bundle.responseSets).length, 2);
  assert.deepEqual(bundle.questions.q36, q36);

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
  await access(new URL("../dist-static/data/catalog.json", import.meta.url));
  await access(new URL("../dist-static/data/bundle.json", import.meta.url));
  await access(new URL("../dist-static/data/questions/q36.json", import.meta.url));
  await access(root);
});
