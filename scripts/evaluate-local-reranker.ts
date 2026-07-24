import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { catalogMatch } from "../app/api";
import { rerankRespectsExplicitRoles } from "../app/question-rerank";
import type { Question } from "../app/types";

interface CatalogQuestion {
  id: string;
  text: string;
  topicId: string;
  modes: string[];
  waves: number[];
}

interface CatalogTopic {
  id: string;
  labelEn: string;
}

interface Case {
  name: string;
  query: string;
  normalizedQuery?: string;
  candidates: string[];
  expectedFirst: string;
  acceptableFirst?: string[];
}

const cases: Case[] = [
  {
    name: "zh democracy level",
    query: "日本的民主程度在各波平均值",
    candidates: ["q91", "q95", "q96", "q100", "q135"],
    expectedFirst: "q96",
  },
  {
    name: "en democracy level",
    query: "Mean democracy rating in Japan by wave",
    normalizedQuery: "democracy rating",
    candidates: ["q91", "q95", "q96", "q100", "q129"],
    expectedFirst: "q96",
  },
  {
    name: "zh democracy satisfaction",
    query: "韩国民众对民主运作的满意度",
    candidates: ["q91", "q95", "q96", "q100", "q135"],
    expectedFirst: "q95",
  },
  {
    name: "en democracy meaning",
    query: "What does democracy mean to respondents? First response.",
    candidates: ["q91", "q95", "q96", "q100"],
    expectedFirst: "q91",
  },
  {
    name: "zh democracy suitability",
    query: "民主适不适合我们国家",
    candidates: ["q91", "q95", "q96", "q100", "q135"],
    expectedFirst: "q100",
  },
  {
    name: "zh China influence amount",
    query: "日本人认为中国对本国有多大影响",
    candidates: ["q172", "q174", "q175", "q177", "q178"],
    expectedFirst: "q177",
  },
  {
    name: "en China influence valence",
    query: "Is China's influence on our country positive or negative?",
    candidates: ["q174", "q177", "q178"],
    expectedFirst: "q178",
  },
  {
    name: "zh China regional good or harm",
    query: "中国对亚洲区域是利大于弊还是弊大于利",
    candidates: ["q172", "q174", "q177", "q178"],
    expectedFirst: "q174",
  },
  {
    name: "mixed religious law",
    query: "宗教權威是否应该参与 interpreting the laws",
    candidates: ["q9", "q138", "q143", "q145"],
    expectedFirst: "q145",
  },
  {
    name: "en US regional good or harm",
    query: "Does the United States do more good or harm to the region?",
    candidates: ["q128", "q173", "q179", "q180"],
    expectedFirst: "q173",
  },
  {
    name: "zh US influence valence",
    query: "美国对我们国家的影响总体是好还是坏",
    candidates: ["q173", "q179", "q180"],
    expectedFirst: "q180",
  },
  {
    name: "zh national government trust",
    query: "民众对中央政府的信任程度",
    candidates: ["q8", "q9", "q11", "q15", "q143"],
    expectedFirst: "q9",
  },
  {
    name: "en local government trust",
    query: "Trust in local government",
    candidates: ["q9", "q11", "q15", "q16"],
    expectedFirst: "q15",
  },
  {
    name: "mixed parliament trust",
    query: "對 parliament 的信任",
    candidates: ["q9", "q10", "q11", "q12"],
    expectedFirst: "q11",
  },
  {
    name: "zh country economy now",
    query: "国家目前整体经济状况如何",
    candidates: ["q1", "q2", "q3", "q4", "q5"],
    expectedFirst: "q1",
  },
  {
    name: "en family economy now",
    query: "Current economic condition of the respondent's family",
    candidates: ["q1", "q2", "q3", "q4", "q5", "q6"],
    expectedFirst: "q4",
  },
  {
    name: "zh country economy change",
    query: "过去几年国家经济状况的变化",
    candidates: ["q1", "q2", "q3", "q4", "q5"],
    expectedFirst: "q2",
  },
  {
    name: "en country economy future",
    query: "Expected state of the country's economy a few years from now",
    candidates: ["q1", "q2", "q3", "q4", "q6"],
    expectedFirst: "q3",
  },
  {
    name: "zh democracy best form",
    query: "民主虽然有问题但仍是最好的政府形式",
    candidates: ["q95", "q96", "q100", "q133", "q135"],
    expectedFirst: "q135",
  },
  {
    name: "en democracy versus development",
    query: "Which is more important, democracy or economic development?",
    candidates: ["q95", "q100", "q133", "q135"],
    expectedFirst: "q133",
  },
  {
    name: "zh army rule",
    query: "是否应该让军队接管政府",
    candidates: ["q13", "q138", "q145", "q148"],
    expectedFirst: "q138",
  },
  {
    name: "en political interest",
    query: "How interested are respondents in politics?",
    candidates: ["q47", "q48", "q49", "q77"],
    expectedFirst: "q47",
  },
  {
    name: "zh internet political expression",
    query: "有没有通过互联网或社交媒体表达政治意见",
    candidates: ["q48", "q49", "q53", "q77"],
    expectedFirst: "q77",
  },
  {
    name: "en election fairness",
    query: "How free and fair was the last national election?",
    candidates: ["q36", "q37", "q41", "q47"],
    expectedFirst: "q41",
  },
  {
    name: "zh social trust binary",
    query: "一般来说大多数人是否值得信任",
    candidates: ["q23", "q24", "q25", "q26"],
    expectedFirst: "q23",
    acceptableFirst: ["q23", "q25"],
  },
  {
    name: "en income distribution fairness",
    query: "How fair is income distribution in the country?",
    candidates: ["q162", "q163", "q164.1", "q167"],
    expectedFirst: "q162",
  },
  {
    name: "zh government reduce inequality",
    query: "政府是否有责任缩小高收入和低收入者差距",
    candidates: ["q162", "q163", "q164.1", "q167"],
    expectedFirst: "q163",
    acceptableFirst: ["q163", "q164.1"],
  },
  {
    name: "mixed national pride",
    query: "受访者有多 proud to be a citizen",
    candidates: ["q156", "q170", "q171", "q182"],
    expectedFirst: "q170",
  },
  {
    name: "zh emigration willingness",
    query: "如果有机会愿不愿意移居其他国家",
    candidates: ["q157", "q170", "q171", "q182"],
    expectedFirst: "q171",
  },
  {
    name: "en ASEAN closeness",
    query: "How close do respondents feel to ASEAN?",
    candidates: ["q170", "q171", "q181", "q182"],
    expectedFirst: "q182",
  },
  {
    name: "zh Korea respondents rate Japan democracy",
    query: "韩国受访者如何评价日本的民主程度",
    normalizedQuery: "evaluate Japan democracy level",
    candidates: ["q95", "q96", "q128", "q129", "q130"],
    expectedFirst: "q129",
  },
  {
    name: "zh Japan respondents rate own democracy",
    query: "日本受访者认为自己的国家有多民主",
    normalizedQuery: "own country democracy level",
    candidates: ["q95", "q96", "q127", "q128", "q129"],
    expectedFirst: "q96",
  },
  {
    name: "en Japan respondents rate US democracy",
    query: "Among respondents in Japan, where would they place the United States on the democracy scale?",
    normalizedQuery: "place United States democracy scale",
    candidates: ["q96", "q127", "q128", "q129", "q130"],
    expectedFirst: "q128",
  },
];

const baseUrl = process.argv[2] ?? "http://localhost:3000";
const catalog = JSON.parse(
  await readFile(resolve(process.cwd(), "public/data/catalog.json"), "utf8"),
) as { questions: CatalogQuestion[]; topics: CatalogTopic[] };
const byId = new Map(catalog.questions.map((question) => [question.id, question]));
const topicLabels = new Map(catalog.topics.map((topic) => [topic.id, topic.labelEn]));
const results = [];

for (const item of cases) {
  const candidates = item.candidates.map((id) => {
    const question = byId.get(id);
    if (!question) throw new Error(`Missing candidate ${id}`);
    return {
      variable_id: question.id,
      question_text: question.text,
      topic_label: question.topicId,
      modes: question.modes,
      waves: question.waves,
    };
  });
  const baselineRanking = candidates
    .map((candidate) => ({
      id: candidate.variable_id,
      score: catalogMatch(
        {
          variable_id: candidate.variable_id,
          question_text: candidate.question_text,
          selection_mode: "single_choice",
          response_set_id: null,
          member_order: null,
          topic_id: candidate.topic_label,
          topic_label: topicLabels.get(candidate.topic_label) ?? candidate.topic_label,
          modes: candidate.modes,
          waves: candidate.waves,
        } as Question,
        item.query,
      ).score,
    }))
    .sort((left, right) => right.score - left.score);
  const baselineFirst = baselineRanking[0]?.id ?? item.candidates[0];
  const baselineScore = baselineRanking[0]?.score ?? 0;
  const baselineMargin = baselineScore - (baselineRanking[1]?.score ?? 0);
  const started = performance.now();
  const response = await fetch(`${baseUrl}/api/question-rerank`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: item.query,
      normalized_query: item.normalizedQuery ?? item.query,
      candidates,
    }),
  });
  const body = (await response.json()) as {
    model?: string;
    confidence?: string;
    candidate_ids?: string[];
    elapsed_ms?: number;
    error?: string;
  };
  const first = body.candidate_ids?.[0] ?? null;
  const modelOrder = body.candidate_ids ?? [];
  const effectiveFirst =
    body.confidence === "high"
    && rerankRespectsExplicitRoles(
      item.query,
      candidates.map((candidate) => ({
        variable_id: candidate.variable_id,
        question_text: candidate.question_text,
        selection_mode: "single_choice",
        response_set_id: null,
        member_order: null,
        topic_id: candidate.topic_label,
        topic_label: topicLabels.get(candidate.topic_label) ?? candidate.topic_label,
        modes: candidate.modes,
        waves: candidate.waves,
      })),
      modelOrder,
    )
      ? first
      : baselineFirst;
  const acceptableFirst = new Set([
    item.expectedFirst,
    ...(item.acceptableFirst ?? []),
  ]);
  results.push({
    name: item.name,
    expected_first: item.expectedFirst,
    baseline_first: baselineFirst,
    baseline_score: Math.round(baselineScore),
    baseline_margin: Math.round(baselineMargin),
    actual_first: first,
    effective_first: effectiveFirst,
    raw_model_passed: response.ok && first !== null && acceptableFirst.has(first),
    passed:
      response.ok
      && effectiveFirst !== null
      && acceptableFirst.has(effectiveFirst),
    confidence: body.confidence ?? null,
    model: body.model ?? null,
    server_elapsed_ms: body.elapsed_ms ?? null,
    client_elapsed_ms: Math.round(performance.now() - started),
    error: body.error ?? null,
  });
}

const passed = results.filter((result) => result.passed).length;
const rawModelPassed = results.filter((result) => result.raw_model_passed).length;
const clientLatencies = results
  .map((result) => result.client_elapsed_ms)
  .sort((left, right) => left - right);
const medianClientLatency =
  clientLatencies[Math.floor(clientLatencies.length / 2)] ?? null;
const p95ClientLatency =
  clientLatencies[Math.min(
    clientLatencies.length - 1,
    Math.ceil(clientLatencies.length * 0.95) - 1,
  )] ?? null;
const highConfidenceModelErrors = results.filter(
  (result) => result.confidence === "high" && !result.raw_model_passed,
);
const failures = results.filter((result) => !result.passed);
process.stdout.write(
  `${JSON.stringify(
    {
      model: "gemma4:26b-mlx",
      endpoint: baseUrl,
      passed,
      total: results.length,
      pass_rate: passed / results.length,
      raw_model_passed: rawModelPassed,
      raw_model_pass_rate: rawModelPassed / results.length,
      median_client_latency_ms: medianClientLatency,
      p95_client_latency_ms: p95ClientLatency,
      high_confidence_model_errors: highConfidenceModelErrors,
      blocked_by_production_guard: highConfidenceModelErrors.filter(
        (result) => result.passed,
      ).length,
      failures,
    },
    null,
    2,
  )}\n`,
);

if (passed !== results.length) process.exitCode = 1;
