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
const {
  applyRerankOrder,
  maybeRerankQuestions,
  rerankRespectsExplicitRoles,
} = await import("../app/question-rerank");

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
  assert.deepEqual(
    data.countries.filter((country) => country.country_code >= 19),
    [
      { country_code: 19, display_name: "Bangladesh" },
      { country_code: 20, display_name: "Sri Lanka" },
    ],
  );
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
  assert.equal(
    (await api.catalogSearch("美国对我们国家的影响总体是好还是坏"))
      .questions[0]?.variable_id,
    "q180",
  );
  assert.equal(
    (await api.catalogSearch("日本人认为中国对本国有多大影响"))
      .questions[0]?.variable_id,
    "q177",
  );
});

test("remote rerank output can only reorder grounded candidates", async () => {
  const data = await api.bootstrap();
  const candidates = ["q91", "q95", "q96"]
    .map((id) => data.questions.find((question) => question.variable_id === id))
    .filter((question): question is NonNullable<typeof question> => Boolean(question));
  assert.deepEqual(
    applyRerankOrder(candidates, ["q96", "q96", "q999", "q95"]).map(
      (question) => question.variable_id,
    ),
    ["q96", "q95", "q91"],
  );
});

test("remote rerank only overrides the baseline at high confidence", async () => {
  const data = await api.bootstrap();
  const candidates = ["q91", "q96"]
    .map((id) => data.questions.find((question) => question.variable_id === id))
    .filter((question): question is NonNullable<typeof question> => Boolean(question));
  let responseMode: "high" | "medium" | "deepseek" | "invalid" = "high";
  const fakeWindow = {
    fetch: async (_input: string, init?: RequestInit) => {
      if (!init?.method) {
        return Response.json({
          available: true,
          provider: "deepseek",
          model: "deepseek-v4-flash",
        });
      }
      if (responseMode === "high") {
        return Response.json({
          provider: "deepseek",
          model: "deepseek-v4-flash",
          confidence: "high",
          candidate_ids: ["q96"],
          elapsed_ms: 50,
        });
      }
      if (responseMode === "medium") {
        return Response.json({
          provider: "deepseek",
          model: "deepseek-v4-flash",
          confidence: "medium",
          candidate_ids: ["q96"],
          elapsed_ms: 50,
        });
      }
      if (responseMode === "deepseek") {
        return Response.json({
          provider: "deepseek",
          model: "deepseek-v4-flash",
          confidence: "high",
          candidate_ids: ["q96"],
          elapsed_ms: 50,
        });
      }
      return Response.json({
        provider: "deepseek",
        model: "deepseek-v4-flash",
        confidence: "high",
        candidate_ids: ["q999"],
        elapsed_ms: 50,
      });
    },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  Object.defineProperty(globalThis, "window", {
    value: fakeWindow,
    configurable: true,
  });
  try {
    assert.deepEqual(
      (await maybeRerankQuestions("high confidence test", candidates)).map(
        (question) => question.variable_id,
      ),
      ["q96", "q91"],
    );
    responseMode = "medium";
    assert.deepEqual(
      (await maybeRerankQuestions("medium confidence test", candidates)).map(
        (question) => question.variable_id,
      ),
      ["q91", "q96"],
    );
    responseMode = "invalid";
    assert.deepEqual(
      (await maybeRerankQuestions("invalid candidate test", candidates)).map(
        (question) => question.variable_id,
      ),
      ["q91", "q96"],
    );
    responseMode = "deepseek";
    assert.deepEqual(
      (await maybeRerankQuestions("deepseek fallback test", candidates)).map(
        (question) => question.variable_id,
      ),
      ["q96", "q91"],
    );
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("remote rerank cannot replace an explicit own-country question with a named country", async () => {
  const data = await api.bootstrap();
  const candidates = ["q96", "q129"]
    .map((id) => data.questions.find((question) => question.variable_id === id))
    .filter((question): question is NonNullable<typeof question> => Boolean(question));
  assert.equal(
    rerankRespectsExplicitRoles(
      "日本受訪者認為自己的國家有多民主",
      candidates,
      ["q129", "q96"],
    ),
    false,
  );
  assert.equal(
    rerankRespectsExplicitRoles(
      "韓國受訪者如何評價日本的民主程度",
      candidates,
      ["q129", "q96"],
    ),
    true,
  );
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

test("assistant maps Bangladesh and Sri Lanka without reusing old country labels", async () => {
  const conversation = await api.createConversation();
  const response = await api.sendConversationMessage(
    conversation.conversation_id,
    "q95 Bangladesh and Sri Lanka mean W5",
    conversation.revision,
  );
  assert.equal(response.status, "answered");
  assert.deepEqual(response.active_snapshot?.draft.countries, [19, 20]);

  for (const prompt of ["New Zealand respondents", "Timorese respondents"]) {
    const next = await api.createConversation();
    const rejected = await api.sendConversationMessage(
      next.conversation_id,
      prompt,
      next.revision,
    );
    assert.equal(rejected.status, "unsupported", prompt);
  }
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

test("assistant ranks the requested measure and statistic above broad topic matches", async () => {
  const prompts = [
    "日本的民主程度在各波平均值",
    "日本的民主化程度，各波平均數",
    "日本人覺得自己的國家有多民主，各波平均",
    "mean democracy rating in Japan across waves",
    "How democratic is Japan on average in every wave?",
    "democracy rating Japan mean by wave",
  ];
  for (const prompt of prompts) {
    const conversation = await api.createConversation();
    const response = await api.sendConversationMessage(
      conversation.conversation_id,
      prompt,
      conversation.revision,
    );
    assert.equal(response.pending?.kind, "question", prompt);
    assert.equal(response.options[0]?.value, "q96", prompt);
    assert.equal(
      response.options.some((option) => option.value === "q91"),
      false,
      prompt,
    );
  }
});

test("assistant recognizes multilingual all-country and all-wave scope expressions", async () => {
  const countryAliases = [
    "所有國家",
    "全部国家",
    "全地區",
    "各國",
    "all countries",
    "every country",
    "every region",
    "all respondent regions",
  ];
  for (const alias of countryAliases) {
    const conversation = await api.createConversation();
    const response = await api.sendConversationMessage(
      conversation.conversation_id,
      `q95 ${alias} mean W2`,
      conversation.revision,
    );
    assert.equal(response.status, "answered", alias);
    assert.equal(response.active_snapshot?.draft.countries.length, 18, alias);
  }

  const waveAliases = [
    "所有波次",
    "全部可用波次",
    "each wave",
    "every available wave",
    "multiple waves",
  ];
  for (const alias of waveAliases) {
    const conversation = await api.createConversation();
    const response = await api.sendConversationMessage(
      conversation.conversation_id,
      `q95 Japan mean ${alias}`,
      conversation.revision,
    );
    assert.equal(response.status, "answered", alias);
    assert.deepEqual(response.active_snapshot?.draft.waves, [1, 2, 3, 4, 5, 6], alias);
  }
});

test("assistant preserves question choices when scope is supplied during clarification", async () => {
  const conversation = await api.createConversation();
  const candidates = await api.sendConversationMessage(
    conversation.conversation_id,
    "民主滿意度",
    conversation.revision,
  );
  assert.equal(candidates.pending?.kind, "question");
  const valuesBefore = candidates.options.map((option) => option.value);

  const scoped = await api.sendConversationMessage(
    conversation.conversation_id,
    "所有國家",
    candidates.revision,
  );
  assert.equal(scoped.pending?.kind, "question");
  assert.deepEqual(
    scoped.options.map((option) => option.value),
    valuesBefore,
  );
  assert.match(scoped.message, /已記錄這項分析條件/u);
});

test("assistant treats a semantic topic with scope words as a new question", async () => {
  const conversation = await api.createConversation();
  const initial = await api.sendConversationMessage(
    conversation.conversation_id,
    "q1 Japan mean all waves",
    conversation.revision,
  );
  assert.equal(initial.status, "answered");

  const switched = await api.sendConversationMessage(
    conversation.conversation_id,
    "日本的民主程度在各波平均值",
    initial.revision,
  );
  assert.equal(switched.pending?.kind, "question");
  assert.equal(switched.options[0]?.value, "q96");
});

test("assistant offers compatible questions when a selected item cannot use the requested statistic", async () => {
  const conversation = await api.createConversation();
  const candidates = await api.sendConversationMessage(
    conversation.conversation_id,
    "日本的民主程度在各波",
    conversation.revision,
  );
  const q91 = candidates.options.find((option) => option.value === "q91");
  assert.ok(q91);

  const selected = await api.sendConversationCommand(
    conversation.conversation_id,
    {
      kind: "select_pending_option",
      pending_id: candidates.pending!.pending_id,
      option_id: q91.option_id,
    },
    candidates.revision,
    "q91",
  );
  const distribution = selected.options.find(
    (option) => option.value === "distribution",
  );
  assert.ok(distribution);
  const analyzed = await api.sendConversationCommand(
    conversation.conversation_id,
    {
      kind: "select_pending_option",
      pending_id: selected.pending!.pending_id,
      option_id: distribution.option_id,
    },
    selected.revision,
    "回答分布",
  );
  assert.equal(analyzed.status, "answered");

  const revised = await api.sendConversationMessage(
    conversation.conversation_id,
    "改看平均分",
    analyzed.revision,
  );
  assert.equal(revised.pending?.kind, "question");
  assert.equal(revised.options[0]?.value, "q96");
  assert.match(revised.message, /q91 沒有可用的平均分設定/u);
  assert.match(
    localizeAssistantMessage("en", revised.message),
    /does not have a usable mean score definition/i,
  );
});

test("assistant expands compact wave ranges", async () => {
  const conversation = await api.createConversation();
  const response = await api.sendConversationMessage(
    conversation.conversation_id,
    "q95 Japan mean W2-W4",
    conversation.revision,
  );
  assert.equal(response.status, "answered");
  assert.deepEqual(response.active_snapshot?.draft.waves, [2, 3, 4]);
});

test("assistant understands relative wave quantities in Chinese and English", async () => {
  const cases: Array<[string, number[]]> = [
    ["q95 Japan mean 前三波", [1, 2, 3]],
    ["q95 Japan mean 最近兩波", [5, 6]],
    ["q95 Japan mean first three waves", [1, 2, 3]],
    ["q95 Japan mean latest two waves", [5, 6]],
  ];
  for (const [prompt, expected] of cases) {
    const conversation = await api.createConversation();
    const response = await api.sendConversationMessage(
      conversation.conversation_id,
      prompt,
      conversation.revision,
    );
    assert.equal(response.status, "answered", prompt);
    assert.deepEqual(response.active_snapshot?.draft.waves, expected, prompt);
  }
});

test("assistant treats English switch-to phrases as scope changes", async () => {
  const conversation = await api.createConversation();
  const initial = await api.sendConversationMessage(
    conversation.conversation_id,
    "q95 Japan mean W2",
    conversation.revision,
  );
  const countries = await api.sendConversationMessage(
    conversation.conversation_id,
    "switch to every country",
    initial.revision,
  );
  assert.equal(countries.status, "answered");
  assert.equal(countries.active_snapshot?.draft.countries.length, 18);

  const waves = await api.sendConversationMessage(
    conversation.conversation_id,
    "switch to across waves",
    countries.revision,
  );
  assert.equal(waves.status, "answered");
  assert.deepEqual(waves.active_snapshot?.draft.waves, [1, 2, 3, 4, 5, 6]);
});

test("assistant rejects explicit United States respondent wording", async () => {
  for (const prompt of ["美國受訪者", "我要看美國的受訪者資料"]) {
    const conversation = await api.createConversation();
    const response = await api.sendConversationMessage(
      conversation.conversation_id,
      prompt,
      conversation.revision,
    );
    assert.equal(response.status, "unsupported", prompt);
  }
});
