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
  assert.equal(validateTurnProgram({
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
  }, input), null);
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
  assert.equal(validateTurnProgram({
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
  }, input), null);
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
    assert.match(messages[1].content, /把受訪地區縮小到日本和韓國/u);
    assert.equal((providerBody!.tools as unknown[]).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.DEEPSEEK_MODEL;
    else process.env.DEEPSEEK_MODEL = originalModel;
  }
});

test("cloud turn route fails closed when the provider invents a respondent country", async () => {
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
    assert.equal(response.status, 502);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});
