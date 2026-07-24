import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const publicRoot = resolve(process.cwd(), "public");

globalThis.fetch = async (input: string | URL | Request): Promise<Response> => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.pathname
        : new URL(input.url).pathname;
  const pathname = url.startsWith("http")
    ? new URL(url).pathname
    : url.split("?")[0];
  try {
    const body = await readFile(resolve(publicRoot, `.${pathname}`));
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
};

const { api, catalogMatch } = await import("../app/api");
const { localizeAssistantMessage, localizeOptionLabel } = await import("../app/i18n");

function draft(
  overrides: Partial<Parameters<typeof api.analyze>[0]> = {},
): Parameters<typeof api.analyze>[0] {
  return {
    schema_version: 2,
    target_kind: "question",
    target_id: "q95",
    mode: "continuous",
    operation: "summary",
    countries: [1],
    waves: [1],
    grouping: "none",
    coverage_policy: "cellwise_available",
    weighted: false,
    secondary_id: null,
    secondary_mode: null,
    percentage_basis: "row",
    response_scope: "any_member",
    member_order: null,
    origin: "manual",
    revision: 0,
    ...overrides,
  };
}

test("bootstrap exposes the complete reviewed cloud catalog", async () => {
  const data = await api.bootstrap();
  assert.equal(data.dataset.question_count, 199);
  assert.equal(data.dataset.source_rows, 118_961);
  assert.equal(data.countries.length, 18);
  assert.deepEqual(data.waves, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(
    data.response_sets.map((item) => item.response_set_id).sort(),
    ["important_national_problems", "organization_membership"],
  );
});

test("question contracts preserve analysis modes and coverage", async () => {
  const q95 = await api.question("q95");
  assert.deepEqual(q95.modes, ["category", "order", "continuous"]);
  assert.ok(q95.base_contexts.length > 0);
  assert.equal(q95.contexts.continuous?.some(
    (context) => context.country_code === 1 && context.wave === 1,
  ), true);

  const q172 = await api.question("q172");
  assert.deepEqual(q172.modes, ["category"]);
});

test("catalog search returns a ranked complete candidate pool", async () => {
  const result = await api.catalogSearch("government");
  assert.equal(result.total, result.questions.length);
  assert.ok(result.total > 5);
  assert.ok(result.questions.every((question) =>
    /government/i.test(`${question.question_text} ${question.topic_label}`),
  ));
  assert.ok(result.questions.every((question) =>
    ["high", "related", "broad"].includes(String(question.match_band)),
  ));
  assert.ok(result.questions.every((question) =>
    Array.isArray(question.match_reasons) && question.match_reasons.length > 0,
  ));
  assert.equal(
    (await api.catalogSearch("q95")).questions[0]?.variable_id,
    "q95",
  );
  assert.equal(
    (await api.catalogSearch("q95")).questions[0]?.match_band,
    "high",
  );
  const q95 = (await api.bootstrap()).questions.find((item) => item.variable_id === "q95");
  assert.ok(q95);
  assert.notEqual(catalogMatch(q95, "q95 unrelated nonsense").band, "high");
  const governmentMatch = catalogMatch(result.questions[0], "government");
  assert.equal(
    new Set(governmentMatch.reasons).size,
    governmentMatch.reasons.length,
  );
  const chinaInfluence = await api.catalogSearch(
    "Which questions are about China's influence?",
  );
  assert.ok(["q177", "q178"].includes(chinaInfluence.questions[0]?.variable_id));
  assert.equal(chinaInfluence.questions[0]?.match_band, "high");
});

test("continuous summaries reproduce aggregate q95 values", async () => {
  const result = await api.analyze(
    draft({
      countries: [1, 3],
      waves: [1, 2, 3, 4, 5, 6],
      grouping: "country_wave",
    }),
  );
  const japanWave1Mean = result.result.rows.find(
    (row) =>
      row.metric === "mean" &&
      row.dimensions?.some(
        (dimension) => dimension.kind === "country" && dimension.value_key === "1",
      ) &&
      row.dimensions?.some(
        (dimension) => dimension.kind === "wave" && dimension.value_key === "1",
      ),
  );
  assert.ok(japanWave1Mean);
  assert.ok(Math.abs(Number(japanWave1Mean.estimate) - 2.456989247311828) < 1e-12);
  assert.equal(japanWave1Mean.base_n, 1302);
  assert.equal(result.result.metadata.total_records_n, 15_094);
  assert.equal(result.result.metadata.analysis_unweighted_n, 14_592);
});

test("cellwise coverage keeps q145 results and identifies absent early waves", async () => {
  const conversation = await api.createConversation();
  const response = await api.sendConversationMessage(
    conversation.conversation_id,
    "q145 Philippines Taiwan Indonesia all waves distribution",
    conversation.revision,
  );
  assert.equal(response.status, "answered");
  assert.ok(response.active_snapshot);
  assert.ok(response.active_snapshot.view.rows.length > 0);
  assert.deepEqual(
    response.active_snapshot.view.coverage.excluded_contexts
      .map((item) => `${item.country_code}-W${item.wave}`)
      .sort(),
    ["6-W1", "6-W2", "7-W1", "7-W2", "9-W1", "9-W2"],
  );
});

test("multiple-response analysis supports any and specific response positions", async () => {
  const detail = await api.responseSet("organization_membership");
  assert.equal(detail.members.length, 3);
  assert.ok(detail.contexts.length > 0);
  assert.ok((detail.member_contexts["1"] ?? []).length > 0);

  const anyPosition = await api.analyze(
    draft({
      target_kind: "response_set",
      target_id: "organization_membership",
      mode: "category",
      operation: "multi_response",
      countries: [1],
      waves: [1, 2, 3, 4, 5, 6],
      grouping: "wave",
      response_scope: "any_member",
    }),
  );
  assert.ok(anyPosition.result.rows.length > 0);
  assert.ok(anyPosition.result.rows.every((row) => row.member_order == null));

  const firstPosition = await api.analyze(
    draft({
      target_kind: "response_set",
      target_id: "organization_membership",
      mode: "category",
      operation: "multi_response",
      countries: [1],
      waves: [1, 2, 3, 4, 5, 6],
      grouping: "wave",
      response_scope: "specific_member",
      member_order: 1,
    }),
  );
  assert.ok(firstPosition.result.rows.length > 0);
  assert.ok(firstPosition.result.rows.every((row) => row.member_order === 1));
});

test("assistant rejects unsupported respondent samples even with another place in the sentence", async () => {
  const conversation = await api.createConversation();
  const standalone = await api.sendConversationMessage(
    conversation.conversation_id,
    "美國人？",
    conversation.revision,
  );
  assert.equal(standalone.status, "unsupported");

  const secondConversation = await api.createConversation();
  const correction = await api.sendConversationMessage(
    secondConversation.conversation_id,
    "你這個不是大陸人麼？我要看的是美國人的數據",
    secondConversation.revision,
  );
  assert.equal(correction.status, "unsupported");
  assert.match(correction.message, /ABS 資料沒有 United States 的受訪者樣本/u);
  assert.match(
    localizeAssistantMessage("en", correction.message),
    /ABS data do not include respondents from United States/i,
  );
  assert.equal(
    localizeAssistantMessage("zh-Hant", correction.message),
    correction.message,
  );
});

test("assistant searches Chinese topics and returns explicit question choices", async () => {
  const conversation = await api.createConversation();
  const response = await api.sendConversationMessage(
    conversation.conversation_id,
    "哪些題目與中國影響力有關？",
    conversation.revision,
  );
  assert.equal(response.status, "needs_clarification");
  assert.equal(response.pending?.kind, "question");
  const values = response.options.map((option) => option.value);
  assert.ok(values.includes("q177"));
  assert.ok(values.includes("q178"));
  assert.ok(values.includes("q174"));
});

test("assistant can execute a complete explicit request without extra clicks", async () => {
  const conversation = await api.createConversation();
  const response = await api.sendConversationMessage(
    conversation.conversation_id,
    "q95 Japan mean all waves",
    conversation.revision,
  );
  assert.equal(response.status, "answered");
  assert.equal(response.active_snapshot?.view.question_id, "q95");
  assert.equal(response.active_snapshot?.view.statistic, "mean");
  assert.equal(response.active_snapshot?.view.presentation_type, "trend");
  assert.equal(response.active_snapshot?.view.rows.length, 6);
  assert.match(
    localizeAssistantMessage("en", response.message),
    /Completed the mean score analysis for q95/i,
  );
});

test("assistant does not silently calculate means for category-only questions", async () => {
  const conversation = await api.createConversation();
  const response = await api.sendConversationMessage(
    conversation.conversation_id,
    "q172 Japan mean all waves",
    conversation.revision,
  );
  assert.equal(response.status, "needs_clarification");
  assert.equal(response.pending?.kind, "statistic");
  assert.equal(response.options.some((option) => option.value === "mean"), false);
  assert.equal(
    localizeOptionLabel("en", response.options[0].label),
    "response distribution",
  );
});
