import type { AssistantStatus, Question } from "./types";

interface LocalRerankResponse {
  model: string;
  confidence: "high" | "medium" | "low";
  candidate_ids: string[];
  elapsed_ms: number;
}

const STATUS_TIMEOUT_MS = 2_000;
const RERANK_TIMEOUT_MS = 12_000;
const RERANK_CANDIDATE_LIMIT = 20;
const RERANK_CACHE_LIMIT = 128;
const rerankCache = new Map<string, string[]>();
let availabilityPromise: Promise<boolean> | null = null;

function canCallLocalRoute(): boolean {
  return typeof window !== "undefined" && typeof window.fetch === "function";
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await window.fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function detectLocalReranker(): Promise<boolean> {
  if (!canCallLocalRoute()) return false;
  if (!availabilityPromise) {
    availabilityPromise = fetchWithTimeout(
      "/api/local-rerank",
      { headers: { Accept: "application/json" } },
      STATUS_TIMEOUT_MS,
    )
      .then((response) => response.ok)
      .catch(() => false);
  }
  return availabilityPromise;
}

export async function localAssistantStatus(): Promise<AssistantStatus> {
  const available = await detectLocalReranker();
  return available
    ? {
        provider: "direct_ollama",
        available: true,
        label: "Local model and verified statistics",
        detail: "gemma4:26b-mlx reranks grounded question candidates",
      }
    : {
        provider: "offline",
        available: true,
        label: "Cloud catalog and statistics",
        detail: "Deterministic survey planning with aggregate cloud analysis",
      };
}

export function applyRerankOrder(
  questions: Question[],
  candidateIds: string[],
): Question[] {
  const byId = new Map(questions.map((question) => [question.variable_id, question]));
  const seen = new Set<string>();
  const ranked: Question[] = [];
  for (const id of candidateIds) {
    const question = byId.get(id);
    if (!question || seen.has(id)) continue;
    seen.add(id);
    ranked.push(question);
  }
  for (const question of questions) {
    if (!seen.has(question.variable_id)) ranked.push(question);
  }
  return ranked;
}

export function rerankRespectsExplicitRoles(
  query: string,
  questions: Question[],
  candidateIds: string[],
): boolean {
  const normalized = query.normalize("NFKC").toLowerCase();
  const explicitlyOwnCountry =
    /\b(?:their\s+own|respondents?['’]?\s+own|own)\s+country\b/iu.test(normalized)
    || /(?:自己(?:的)?|受訪者自己(?:的)?|受访者自己(?:的)?)(?:國家|国家)/u.test(normalized);
  if (!explicitlyOwnCountry) return true;
  const byId = new Map(questions.map((question) => [question.variable_id, question]));
  const first = candidateIds.length ? byId.get(candidateIds[0]) : null;
  const hasOwnCountryCandidate = questions.some((question) =>
    /\[country\]/iu.test(question.question_text),
  );
  return !hasOwnCountryCandidate || Boolean(first && /\[country\]/iu.test(first.question_text));
}

export async function maybeRerankQuestions(
  query: string,
  questions: Question[],
  normalizedQuery = query,
): Promise<Question[]> {
  if (
    questions.length < 2
    || /\bq\d+(?:\.\d+)?\b/iu.test(query)
    || !(await detectLocalReranker())
  ) {
    return questions;
  }
  const candidates = questions.slice(0, RERANK_CANDIDATE_LIMIT);
  const cacheKey = `${query.normalize("NFKC").trim().toLowerCase()}\u0000${candidates
    .map((question) => question.variable_id)
    .join(",")}`;
  const cached = rerankCache.get(cacheKey);
  if (cached) return applyRerankOrder(questions, cached);
  try {
    const response = await fetchWithTimeout(
      "/api/local-rerank",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          normalized_query: normalizedQuery,
          candidates: candidates.map((question) => ({
            variable_id: question.variable_id,
            question_text: question.question_text,
            topic_label: question.topic_label,
            modes: question.modes,
            waves: question.waves,
          })),
        }),
      },
      RERANK_TIMEOUT_MS,
    );
    if (!response.ok) return questions;
    const document = (await response.json()) as Partial<LocalRerankResponse>;
    if (
      document.model !== "gemma4:26b-mlx"
      || document.confidence !== "high"
      || !Array.isArray(document.candidate_ids)
      || !document.candidate_ids.length
      || document.candidate_ids.some((id) => typeof id !== "string")
    ) {
      return questions;
    }
    const allowed = new Set(candidates.map((question) => question.variable_id));
    const uniqueIds = [...new Set(document.candidate_ids)];
    if (
      uniqueIds.some((id) => !allowed.has(id))
      || !rerankRespectsExplicitRoles(query, candidates, uniqueIds)
    ) return questions;
    rerankCache.set(cacheKey, uniqueIds);
    if (rerankCache.size > RERANK_CACHE_LIMIT) {
      const oldest = rerankCache.keys().next().value;
      if (oldest) rerankCache.delete(oldest);
    }
    return applyRerankOrder(questions, uniqueIds);
  } catch {
    return questions;
  }
}
