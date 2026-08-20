import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { CloudTurnContext, ConversationResponse, TurnProgram } from "../app/types";

const baseUrl = new URL(process.argv[2] ?? "http://localhost:3000");
const outputPath = resolve(
  process.argv[3] ?? "../reports/benchmarks/country_dialogue_state.json",
);
const publicRoot = resolve(process.cwd(), "public");
const networkFetch = globalThis.fetch;

globalThis.fetch = async (input: string | URL | Request): Promise<Response> => {
  const url = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  const pathname = url.startsWith("http") ? new URL(url).pathname : url.split("?")[0];
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

const { api } = await import("../app/api");
const { setCloudTurnProgramResolverForTests } = await import("../app/cloud-turn-program");

async function resolveProgram(context: CloudTurnContext): Promise<TurnProgram | null> {
  const response = await networkFetch(new URL("/api/turn-program", baseUrl), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: baseUrl.origin,
      "User-Agent": "CountryDialogueStateQA/1.0",
      "X-Forwarded-For": "198.51.100.99",
    },
    body: JSON.stringify(context),
  });
  if (!response.ok) throw new Error(`turn-program HTTP ${response.status}`);
  const document = await response.json() as { program?: TurnProgram };
  return document.program ?? null;
}

interface Step {
  id: string;
  message: string;
  status: ConversationResponse["status"];
  countries: number[];
}

const steps: Step[] = [
  { id: "initial", message: "q96 Japan mean all waves", status: "answered", countries: [1] },
  { id: "ellipsis_single_scope", message: "韓國的話呢？", status: "answered", countries: [3] },
  { id: "add_explicit", message: "再把日本放進來。", status: "answered", countries: [1, 3] },
  { id: "remove_colloquial", message: "韓國先拿掉。", status: "answered", countries: [1] },
  { id: "ellipsis_other_single", message: "至於大陸？", status: "answered", countries: [4] },
  { id: "add_incidental", message: "順便把韓國一併放進來。", status: "answered", countries: [3, 4] },
  { id: "ellipsis_multi_scope", message: "至於台灣？", status: "needs_clarification", countries: [3, 4] },
  { id: "set_explicit_after_unclear", message: "把受訪地區改成台灣。", status: "answered", countries: [7] },
  { id: "deny_remove", message: "不要移除台灣。", status: "needs_clarification", countries: [7] },
  { id: "set_colloquial", message: "換韓國看看。", status: "answered", countries: [3] },
];

const conversation = await api.createConversation();
let revision = conversation.revision;
const results = [];
setCloudTurnProgramResolverForTests(resolveProgram);
try {
  for (const step of steps) {
    const started = performance.now();
    let response: ConversationResponse | null = null;
    let error: string | null = null;
    try {
      response = await api.sendConversationMessage(
        conversation.conversation_id,
        step.message,
        revision,
      );
      revision = response.revision;
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    }
    const actualCountries = response?.active_snapshot?.draft.countries ?? [];
    const reasons = [];
    if (!response) reasons.push("missing_response");
    if (response?.status !== step.status) reasons.push("status");
    if (JSON.stringify(actualCountries) !== JSON.stringify(step.countries)) reasons.push("countries");
    if (response?.active_snapshot?.view.question_id !== "q96") reasons.push("question_changed");
    if (response?.active_snapshot?.view.statistic !== "mean") reasons.push("statistic_changed");
    results.push({
      id: step.id,
      message: step.message,
      passed: reasons.length === 0 && error === null,
      reasons,
      error,
      elapsed_ms: Math.round((performance.now() - started) * 1000) / 1000,
      expected: { status: step.status, countries: step.countries },
      actual: response ? {
        status: response.status,
        countries: actualCountries,
        question_id: response.active_snapshot?.view.question_id ?? null,
        statistic: response.active_snapshot?.view.statistic ?? null,
        message: response.message,
      } : null,
    });
    process.stdout.write(`${step.id}: ${reasons.length === 0 && error === null ? "PASS" : "FAIL"}\n`);
  }
} finally {
  setCloudTurnProgramResolverForTests(null);
}

const passed = results.filter((item) => item.passed).length;
const report = {
  schema_version: "country-dialogue-state.v1",
  created_at: new Date().toISOString(),
  endpoint: baseUrl.origin,
  summary: {
    passed,
    total: results.length,
    pass_rate: passed / results.length,
  },
  results,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);
