import { NextRequest, NextResponse } from "next/server";

const DEEPSEEK_URL = "https://api.deepseek.com";
const DEEPSEEK_MODEL = "deepseek-v4-flash";
const MAX_CANDIDATES = 20;
const MAX_BODY_CHARS = 48_000;
const DEEPSEEK_TIMEOUT_MS = 10_000;
const REMOTE_REQUESTS_PER_MINUTE = 12;

let deepseekVerifiedUntil = 0;
let activeRequests = 0;
const remoteRequestWindows = new Map<string, { count: number; resetAt: number }>();

interface RerankCandidate {
  variable_id: string;
  question_text: string;
  topic_label: string;
  modes: string[];
  waves: number[];
}

interface Ranking {
  candidateIndices: number[];
  confidence: "high" | "medium" | "low";
}

const SYSTEM_PROMPT =
  "Call record_question_ranking exactly once. Rank only supplied candidates by the measurement concept in the original request and normalized search query. First identify internally: (1) who was surveyed, (2) what country, institution, or concept is being rated, and (3) the requested response form when stated. The normalized query may omit geography, so resolve these roles from the original request. A candidate containing [country] always means the respondent's own country. Phrases such as own country, their country, 自己的國家, 自己的国家, 本國, or 本国 therefore require [country] rather than a separately named country. Conversely, when respondents in one country rate another country, prefer the candidate that explicitly names the country being rated and do not select [country]. Distinguish magnitude from valence: how much influence asks magnitude, while positive or negative, good or bad, 好壞, 正面負面, or influence is asks valence. Match response form only when the wording explicitly names an answer format. Distinguish democracy level, satisfaction with democracy, meaning of democracy, support for democracy, respondent geography, and the country discussed by a question. Shared generic words are insufficient. Statistical capability has already been checked. Never invent a candidate, statistic, answer, or explanation. Use low confidence when the concept remains ambiguous.";

function isLocalRequest(request: NextRequest): boolean {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function runtimeSecret(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function sameOrigin(request: NextRequest): boolean {
  if (isLocalRequest(request)) return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function remoteRateLimitKey(request: NextRequest): string {
  return (
    request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown"
  );
}

function remoteRateLimitAllows(request: NextRequest): boolean {
  const now = Date.now();
  const key = remoteRateLimitKey(request);
  const current = remoteRequestWindows.get(key);
  if (!current || now >= current.resetAt) {
    remoteRequestWindows.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (current.count >= REMOTE_REQUESTS_PER_MINUTE) return false;
  current.count += 1;
  return true;
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(DEEPSEEK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Provider request failed");
  return response.json();
}

async function verifyDeepSeek(apiKey: string): Promise<void> {
  if (Date.now() < deepseekVerifiedUntil) return;
  const document = await fetchJson(
    `${DEEPSEEK_URL}/models`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  const models = document && typeof document === "object"
    ? (document as { data?: unknown }).data
    : null;
  if (
    !Array.isArray(models)
    || !models.some((item) =>
      item
      && typeof item === "object"
      && (item as Record<string, unknown>).id === DEEPSEEK_MODEL)
  ) throw new Error("Configured DeepSeek model is unavailable");
  deepseekVerifiedUntil = Date.now() + 30_000;
}

function validCandidate(value: unknown): value is RerankCandidate {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RerankCandidate>;
  return (
    typeof item.variable_id === "string"
    && /^q\d+(?:\.\d+)?$/iu.test(item.variable_id)
    && typeof item.question_text === "string"
    && item.question_text.length > 0
    && item.question_text.length <= 600
    && typeof item.topic_label === "string"
    && item.topic_label.length <= 200
    && Array.isArray(item.modes)
    && item.modes.every((mode) => ["category", "order", "continuous"].includes(mode))
    && Array.isArray(item.waves)
    && item.waves.every((wave) => Number.isInteger(wave) && wave >= 1 && wave <= 6)
  );
}

function rankingTool(maximum: number) {
  return {
    type: "function",
    function: {
      name: "record_question_ranking",
      description: "Rank only the supplied survey questions by measurement relevance.",
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          candidate_indices: {
            type: "array",
            items: { type: "integer", minimum: 0, maximum },
            uniqueItems: true,
            minItems: 1,
            maxItems: 8,
          },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["candidate_indices", "confidence"],
      },
    },
  };
}

function rankingInput(
  query: string,
  normalizedQuery: string,
  candidates: RerankCandidate[],
) {
  return JSON.stringify({
    request: query,
    normalized_search_query: normalizedQuery,
    candidates: candidates.map((candidate, index) => ({ index, ...candidate })),
  });
}

function validateRanking(indices: unknown, confidence: unknown, maximum: number): Ranking {
  if (
    !Array.isArray(indices)
    || !indices.length
    || indices.length > 8
    || !indices.every((index) =>
      Number.isInteger(index) && Number(index) >= 0 && Number(index) <= maximum)
    || new Set(indices).size !== indices.length
    || !["high", "medium", "low"].includes(String(confidence))
  ) throw new Error("Invalid model response");
  return {
    candidateIndices: indices.map(Number),
    confidence: confidence as Ranking["confidence"],
  };
}

async function rankWithDeepSeek(
  apiKey: string,
  query: string,
  normalizedQuery: string,
  candidates: RerankCandidate[],
): Promise<Ranking> {
  await verifyDeepSeek(apiKey);
  const maximum = candidates.length - 1;
  const document = await fetchJson(
    `${DEEPSEEK_URL}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: rankingInput(query, normalizedQuery, candidates) },
        ],
        thinking: { type: "disabled" },
        temperature: 0,
        max_tokens: 256,
        tools: [rankingTool(maximum)],
        tool_choice: {
          type: "function",
          function: { name: "record_question_ranking" },
        },
      }),
    },
  );
  const response = document as {
    model?: unknown;
    choices?: Array<{
      finish_reason?: unknown;
      message?: {
        tool_calls?: Array<{
          function?: { name?: unknown; arguments?: unknown };
        }>;
      };
    }>;
  };
  const call = response.choices?.[0]?.message?.tool_calls?.find(
    (item) => item.function?.name === "record_question_ranking",
  );
  if (
    response.model !== DEEPSEEK_MODEL
    || response.choices?.[0]?.finish_reason !== "tool_calls"
    || !call
    || typeof call.function?.arguments !== "string"
  ) throw new Error("Invalid DeepSeek response");
  const args = JSON.parse(call.function.arguments) as {
    candidate_indices?: unknown;
    confidence?: unknown;
  };
  return validateRanking(args.candidate_indices, args.confidence, maximum);
}

export async function GET(): Promise<NextResponse> {
  const apiKey = runtimeSecret("DEEPSEEK_API_KEY");
  if (!apiKey) return NextResponse.json({ available: false }, { status: 503 });
  try {
    await verifyDeepSeek(apiKey);
    return NextResponse.json({
      available: true,
      provider: "deepseek",
      model: DEEPSEEK_MODEL,
    });
  } catch {
    return NextResponse.json({ available: false }, { status: 503 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }
  if (activeRequests >= 2) {
    return NextResponse.json({ error: "Question reranker is busy." }, { status: 429 });
  }
  activeRequests += 1;
  const started = Date.now();
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) {
      return NextResponse.json({ error: "Request is too large." }, { status: 413 });
    }
    const body = JSON.parse(raw) as {
      query?: unknown;
      normalized_query?: unknown;
      candidates?: unknown;
    };
    if (
      typeof body.query !== "string"
      || !body.query.trim()
      || body.query.length > 1_000
      || typeof body.normalized_query !== "string"
      || body.normalized_query.length > 1_000
      || !Array.isArray(body.candidates)
      || body.candidates.length < 2
      || body.candidates.length > MAX_CANDIDATES
      || !body.candidates.every(validCandidate)
    ) return NextResponse.json({ error: "Invalid rerank request." }, { status: 400 });

    const apiKey = runtimeSecret("DEEPSEEK_API_KEY");
    if (!apiKey) {
      return NextResponse.json({ error: "No model provider is available." }, { status: 503 });
    }
    if (!remoteRateLimitAllows(request)) {
      return NextResponse.json({ error: "Remote rerank limit reached." }, { status: 429 });
    }
    const candidates = body.candidates as RerankCandidate[];
    const ranking = await rankWithDeepSeek(
      apiKey,
      body.query,
      body.normalized_query,
      candidates,
    );
    return NextResponse.json({
      provider: "deepseek",
      model: DEEPSEEK_MODEL,
      confidence: ranking.confidence,
      candidate_ids: ranking.candidateIndices.map((index) => candidates[index].variable_id),
      elapsed_ms: Date.now() - started,
    });
  } catch {
    return NextResponse.json({ error: "Question reranking failed." }, { status: 503 });
  } finally {
    activeRequests -= 1;
  }
}
