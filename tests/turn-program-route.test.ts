import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import type { CloudTurnContext } from "../app/types";
import { validateTurnProgram } from "../app/turn-program-contract";

function context(latestMessage = "把受訪地區縮小到日本和韓國"): CloudTurnContext {
  return {
    latest_message: latestMessage,
    current_goal: {
      question_id: "q95",
      question_text: "On the whole, how satisfied or dissatisfied are you with the way democracy works in [country]?",
      respondent_countries: ["Japan", "South Korea", "Taiwan"],
      country_codes: [1, 3, 7],
      waves: [3, 4],
      statistic: "distribution",
      representation: "category",
      category_options: [],
      selected_category_labels: [],
    },
    pending: null,
    recent_exchanges: [
      { role: "user", content: "我要看各國對本國民主的滿意度" },
      { role: "assistant", content: "已完成 q95 的回答分布分析。" },
    ],
    prior_effective_change: true,
    turn_mode: "continue",
  };
}

test("turn-program validator accepts grounded edits and rejects invented values", () => {
  const input = context();
  assert.ok(validateTurnProgram({
    schema_version: 1,
    relation: "revise",
    commands: [{
      kind: "modify_countries",
      operation: "set",
      values: ["Japan", "South Korea"],
      selector: "explicit",
    }],
    unresolved: [],
    source: "model",
  }, input));
  const invented = validateTurnProgram({
    schema_version: 1,
    relation: "revise",
    commands: [{
      kind: "modify_countries",
      operation: "set",
      values: ["Atlantis"],
      selector: "explicit",
    }],
    unresolved: [],
    source: "model",
  }, input);
  assert.equal(invented?.relation, "unclear");
  assert.deepEqual(invented?.commands, []);
  assert.equal(invented?.unresolved[0]?.slot, "country_role");
  const negated = validateTurnProgram({
    schema_version: 1,
    relation: "revise",
    commands: [{
      kind: "modify_countries",
      operation: "add",
      values: ["Japan"],
      selector: "explicit",
    }],
    unresolved: [],
    source: "model",
  }, context("不要把日本移除"));
  assert.equal(negated?.relation, "unclear");
  assert.deepEqual(negated?.commands, []);
  const overGenerated = validateTurnProgram({
    schema_version: 1,
    relation: "start",
    commands: [
      {
        kind: "search_questions",
        purpose: "analyze",
        query_original: "我要看各国对于本国民主的满意度",
        query_en: "satisfaction with democracy",
        object_entities: [],
      },
      {
        kind: "modify_countries",
        operation: "set",
        values: [],
        selector: "all_available",
      },
      {
        kind: "modify_waves",
        operation: "set",
        values: [],
        selector: "all_available",
      },
    ],
    unresolved: [],
    source: "model",
  }, {
    ...context("我要看各国对于本国民主的满意度"),
    current_goal: null,
    prior_effective_change: false,
    turn_mode: "start",
  });
  assert.deepEqual(
    overGenerated?.commands.map((command) => command.kind),
    ["search_questions", "modify_countries"],
  );
  const mismatchedSearch = validateTurnProgram({
    schema_version: 1,
    relation: "start",
    commands: [{
      kind: "search_questions",
      purpose: "analyze",
      query_original: "a different user message",
      query_en: "democracy satisfaction",
      object_entities: [],
    }],
    unresolved: [],
    source: "model",
  }, input);
  assert.equal(mismatchedSearch?.relation, "unclear");
  assert.deepEqual(mismatchedSearch?.commands, []);
  assert.equal(mismatchedSearch?.unresolved[0]?.slot, "question");
});

test("cloud turn route sends bounded conversation state and returns only a validated program", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  const originalModel = process.env.DEEPSEEK_MODEL;
  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.DEEPSEEK_MODEL = "deepseek-v4-flash";
  let providerBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    assert.equal(new URL(request.url).pathname, "/chat/completions");
    assert.equal(request.headers.get("authorization"), "Bearer test-key");
    providerBody = JSON.parse(await request.text()) as Record<string, unknown>;
    return Response.json({
      model: "deepseek-v4-flash",
      choices: [{
        finish_reason: "tool_calls",
        message: {
          tool_calls: [{
            function: {
              name: "record_turn_program",
              arguments: JSON.stringify({
                schema_version: 1,
                relation: "revise",
                commands: [{
                  kind: "modify_countries",
                  operation: "set",
                  values: ["Japan", "South Korea"],
                  selector: "explicit",
                }],
                unresolved: [],
                source: "model",
              }),
            },
          }],
        },
      }],
    });
  };
  try {
    const { POST } = await import("../app/api/turn-program/route");
    const response = await POST(new NextRequest("http://localhost/api/turn-program", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "198.51.100.41",
      },
      body: JSON.stringify(context()),
    }));
    assert.equal(response.status, 200);
    const document = await response.json();
    assert.equal(document.provider, "cloud");
    assert.deepEqual(document.program.commands[0].values, ["Japan", "South Korea"]);
    assert.equal("model" in document, false);
    assert.ok(providerBody);
    const messages = providerBody!.messages as Array<{ role: string; content: string }>;
    assert.match(messages[0].content, /only edits countries, waves,[\s\S]*revises the existing question/i);
    assert.match(messages[0].content, /do not assign every short country follow-up one fixed operation/i);
    assert.match(messages[0].content, /together, alongside, as well, besides/i);
    assert.match(messages[0].content, /sole authority for this turn's edit intent/i);
    assert.match(messages[1].content, /把受訪地區縮小到日本和韓國/u);
    assert.match(messages[1].content, /"latest_turn"/u);
    assert.match(messages[1].content, /"context_only_recent_exchanges"/u);
    assert.equal((providerBody!.tools as unknown[]).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.DEEPSEEK_MODEL;
    else process.env.DEEPSEEK_MODEL = originalModel;
  }
});

test("cloud turn route returns a safe unclear program when the provider invents a respondent country", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-key";
  globalThis.fetch = async () => Response.json({
    choices: [{
      finish_reason: "tool_calls",
      message: {
        tool_calls: [{
          function: {
            name: "record_turn_program",
            arguments: JSON.stringify({
              schema_version: 1,
              relation: "revise",
              commands: [{
                kind: "modify_countries",
                operation: "set",
                values: ["Atlantis"],
                selector: "explicit",
              }],
              unresolved: [],
              source: "model",
            }),
          },
        }],
      },
    }],
  });
  try {
    const { POST } = await import("../app/api/turn-program/route");
    const response = await POST(new NextRequest("http://localhost/api/turn-program", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "198.51.100.42",
      },
      body: JSON.stringify(context()),
    }));
    assert.equal(response.status, 200);
    const document = await response.json();
    assert.equal(document.program.relation, "unclear");
    assert.deepEqual(document.program.commands, []);
    assert.equal(document.program.unresolved[0].slot, "country_role");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test("validator does not rewrite an ungrounded country operation into a different intent", () => {
  const input = context("那韓國呢？");
  const program = validateTurnProgram({
    schema_version: 1,
    relation: "revise",
    commands: [{
      kind: "modify_countries",
      operation: "add",
      values: ["South Korea"],
      selector: "explicit",
    }],
    unresolved: [],
    source: "model",
  }, input);
  assert.equal(program?.relation, "unclear");
  assert.deepEqual(program?.commands, []);
});

test("grounded search commands recover an explicitly requested all-country scope", () => {
  const latestMessage = "Switch to satisfaction with the way democracy works in each respondent country, across all available waves, using the response distribution.";
  const program = validateTurnProgram({
    schema_version: 1,
    relation: "revise",
    commands: [
      {
        kind: "search_questions",
        purpose: "analyze",
        query_original: latestMessage,
        query_en: "satisfaction with the way democracy works",
        object_entities: [],
      },
      {
        kind: "modify_waves",
        operation: "set",
        values: [],
        selector: "all_available",
      },
      { kind: "set_statistic", statistic: "distribution" },
    ],
    unresolved: [],
    source: "model",
  }, context(latestMessage));
  assert.deepEqual(program?.commands.map((command) => command.kind), [
    "search_questions",
    "modify_countries",
    "modify_waves",
    "set_statistic",
  ]);
  assert.deepEqual(program?.commands[1], {
    kind: "modify_countries",
    operation: "set",
    values: [],
    selector: "all_available",
  });
});

test("provider uncertainty is preserved instead of being replaced by a phrase-specific country guess", () => {
  const uncertain = {
    schema_version: 1,
    relation: "unclear",
    commands: [],
    unresolved: [{ slot: "country_role", detail: "provider uncertainty" }],
    source: "model",
  };
  const recovered = validateTurnProgram(uncertain, context("那韓國呢？"));
  assert.equal(recovered?.relation, "unclear");
  assert.deepEqual(recovered?.commands, []);

  const fixedQuestion = context("那韓國呢？");
  fixedQuestion.current_goal = {
    ...fixedQuestion.current_goal!,
    question_id: "q178",
    question_text: "Generally speaking, the influence China has on our country is?",
  };
  const stillUnclear = validateTurnProgram(uncertain, fixedQuestion);
  assert.equal(stillUnclear?.relation, "unclear");
  assert.deepEqual(stillUnclear?.commands, []);

  const historyContaminated = validateTurnProgram({
    schema_version: 1,
    relation: "revise",
    commands: [{
      kind: "modify_countries",
      operation: "set",
      values: ["Japan", "South Korea"],
      selector: "explicit",
    }],
    unresolved: [],
    source: "model",
  }, context("那韓國呢？"));
  assert.equal(historyContaminated?.relation, "unclear");
  assert.deepEqual(historyContaminated?.commands, []);
});

test("country operations support broad semantics without copying or flattening the operation", () => {
  const cases = [
    ["連韓國一起看。", "add"],
    ["Show South Korea alongside Japan.", "add"],
    ["韓國先拿掉。", "remove"],
    ["Leave Korea out of the respondent scope.", "remove"],
  ] as const;
  for (const [message, operation] of cases) {
    const program = validateTurnProgram({
      schema_version: 1,
      relation: "revise",
      commands: [{
        kind: "modify_countries",
        operation,
        values: ["South Korea"],
        selector: "explicit",
      }],
      unresolved: [],
      source: "model",
    }, context(message));
    assert.equal(program?.relation, "revise", message);
    assert.equal(program?.commands[0]?.kind, "modify_countries", message);
    if (program?.commands[0]?.kind === "modify_countries") {
      assert.equal(program.commands[0].operation, operation, message);
    }
  }
});

test("country alternatives and fixed-question country roles fail closed", () => {
  const choice = validateTurnProgram({
    schema_version: 1,
    relation: "revise",
    commands: [{
      kind: "modify_countries",
      operation: "set",
      values: ["South Korea", "Japan"],
      selector: "explicit",
    }],
    unresolved: [],
    source: "model",
  }, context("韓國還是日本？"));
  assert.equal(choice?.relation, "unclear");
  assert.equal(choice?.unresolved[0]?.slot, "country_role");

  const fixed = context("韓國的結果呢？");
  fixed.current_goal = {
    ...fixed.current_goal!,
    question_id: "q178",
    question_text: "Generally speaking, the influence China has on our country is?",
  };
  const fixedProgram = validateTurnProgram({
    schema_version: 1,
    relation: "revise",
    commands: [{
      kind: "modify_countries",
      operation: "set",
      values: ["South Korea"],
      selector: "explicit",
    }],
    unresolved: [],
    source: "model",
  }, fixed);
  assert.equal(fixedProgram?.relation, "unclear");
  assert.equal(fixedProgram?.unresolved[0]?.slot, "country_role");
});

test("a keep-one-remove-another sentence cannot be flattened into a destructive set", () => {
  const program = validateTurnProgram({
    schema_version: 1,
    relation: "revise",
    commands: [{
      kind: "modify_countries",
      operation: "set",
      values: ["Japan"],
      selector: "explicit",
    }],
    unresolved: [],
    source: "model",
  }, context("日本留下，韓國去掉。"));
  assert.equal(program?.relation, "unclear");
  assert.deepEqual(program?.commands, []);
});

test("route retries a locally ungrounded country operation with semantic repair guidance", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    if (calls === 2) {
      assert.ok(body.messages.some((message) => /prior attempt failed local semantic grounding/i.test(message.content)));
    }
    const operation = calls === 1 ? "add" : "set";
    return Response.json({
      choices: [{
        finish_reason: "tool_calls",
        message: {
          tool_calls: [{
            function: {
              name: "record_turn_program",
              arguments: JSON.stringify({
                schema_version: 1,
                relation: "revise",
                commands: [{
                  kind: "modify_countries",
                  operation,
                  values: ["South Korea"],
                  selector: "explicit",
                }],
                unresolved: [],
                source: "model",
              }),
            },
          }],
        },
      }],
    });
  };
  try {
    const { POST } = await import("../app/api/turn-program/route");
    const response = await POST(new NextRequest("http://localhost/api/turn-program", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "198.51.100.44",
      },
      body: JSON.stringify(context("至於韓國？")),
    }));
    assert.equal(response.status, 200);
    const document = await response.json();
    assert.equal(calls, 2);
    assert.equal(document.program.commands[0].operation, "set");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test("route preserves state for an explicitly denied operation without calling the provider", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-key";
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("provider should not be called");
  };
  try {
    const { POST } = await import("../app/api/turn-program/route");
    const response = await POST(new NextRequest("http://localhost/api/turn-program", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "198.51.100.45",
      },
      body: JSON.stringify(context("不要移除韓國。")),
    }));
    assert.equal(response.status, 200);
    const document = await response.json();
    assert.equal(called, false);
    assert.equal(document.program.relation, "unclear");
    assert.deepEqual(document.program.commands, []);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});
