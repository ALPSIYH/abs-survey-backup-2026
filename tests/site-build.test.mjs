import assert from "node:assert/strict";
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
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|SkeletonPreview/);
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
  assert.equal(catalog.questions.length, 199);
  assert.equal(catalog.countries.length, 18);
  assert.equal(catalog.responseSets.length, 2);
  assert.equal(questionFiles.filter((name) => name.endsWith(".json")).length, 199);
  assert.equal(responseSetFiles.filter((name) => name.endsWith(".json")).length, 2);
  assert.equal(manifest.questionFiles, 199);
  assert.equal(manifest.responseSetFiles, 2);
  assert.equal(manifest.aggregateCells, 85_807);

  const q95 = JSON.parse(
    await readFile(new URL("../public/data/questions/q95.json", import.meta.url), "utf8"),
  );
  assert.equal(q95.id, "q95");
  assert.ok(q95.scale.length >= 4);
  assert.ok(q95.cells.length > 100);

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
  assert.deepEqual(
    await readdir(new URL("../app/_sites-preview/", import.meta.url)),
    [],
  );
  await access(new URL("../public/og.png", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
  await access(root);
});
