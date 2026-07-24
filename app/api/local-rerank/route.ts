import { NextRequest, NextResponse } from "next/server";

const OLLAMA_URL = "http://127.0.0.1:11434";
const MODEL = "gemma4:26b-mlx";
const MODEL_DIGEST =
  "c8656f50f0a6d864cffd9471002949b027ce4173640c52720f04141c3d73232a";
const MAX_CANDIDATES = 20;
const MAX_BODY_CHARS = 48_000;
const OLLAMA_TIMEOUT_MS = 11_000;
let verifiedUntil = 0;
let activeRequests = 0;

interface RerankCandidate {
  variable_id: string;
  question_text: string;
  topic_label: string;
  modes: string[];
  waves: number[];
}

function isLocalRequest(request: NextRequest): boolean {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

async function ollamaRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${OLLAMA_URL}${path}`, {
    ...init,
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Ollama request failed");
  return response.json();
}

async function verifyModel(): Promise<void> {
  if (Date.now() < verifiedUntil) return;
  const document = await ollamaRequest("/api/tags");
  if (
    !document
    || typeof document !== "object"
    || !Array.isArray((document as { models?: unknown }).models)
  ) {
    throw new Error("Invalid Ollama catalog");
  }
  const matches = (document as { models: Array<Record<string, unknown>> }).models.filter(
    (item) => (item.name === MODEL || item.model === MODEL) && item.digest === MODEL_DIGEST,
  );
  if (matches.length !== 1) throw new Error("Configured local model is unavailable");
  verifiedUntil = Date.now() + 30_000;
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isLocalRequest(request)) {
    return NextResponse.json({ available: false }, { status: 503 });
  }
  try {
    await verifyModel();
    return NextResponse.json({ available: true, model: MODEL });
  } catch {
    return NextResponse.json({ available: false }, { status: 503 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isLocalRequest(request)) {
    return NextResponse.json({ error: "Local reranking is unavailable." }, { status: 503 });
  }
  if (activeRequests >= 2) {
    return NextResponse.json({ error: "Local reranker is busy." }, { status: 429 });
  }
  activeRequests += 1;
  const started = Date.now();
  try {
    await verifyModel();
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
    ) {
      return NextResponse.json({ error: "Invalid rerank request." }, { status: 400 });
    }
    const candidates = body.candidates as RerankCandidate[];
    const maximum = candidates.length - 1;
    const tool = {
      type: "function",
      function: {
        name: "record_question_ranking",
        description: "Rank only the supplied survey questions by measurement relevance.",
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
            confidence: {
              type: "string",
              enum: ["high", "medium", "low"],
            },
          },
          required: ["candidate_indices", "confidence"],
        },
      },
    };
    const document = await ollamaRequest("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        think: false,
        keep_alive: "10m",
        options: { temperature: 0, num_predict: 128 },
        messages: [
          {
            role: "system",
            content:
              "Call record_question_ranking exactly once. Rank only supplied candidates by the measurement concept in the original request and normalized search query. First identify internally: (1) who was surveyed, (2) what country, institution, or concept is being rated, and (3) the requested response form when stated. The normalized query may omit geography, so resolve these roles from the original request. A candidate containing [country] always means the respondent's own country. Phrases such as own country, their country, our country, 自己的國家, 自己的国家, 本國, or 本国 therefore require [country] rather than a separately named country. Conversely, when Korean respondents rate Japan or Japanese respondents rate the United States, prefer the candidate that explicitly names Japan or the United States and do not select [country]. Phrases such as Japanese respondents, among people in Japan, 日本人, or 日本受訪者 normally identify the sample; evaluate Japan, views of Japan, 評價日本, or 對日本 normally identify the measured object. Distinguish magnitude from valence: how much influence asks magnitude, while positive or negative, good or bad, 好壞, 正面負面, or influence is asks valence. Match response form only when the wording explicitly names an answer format: agree/disagree or 同意度 favors an agreement scale, while either-or choices favor a binary question. The Chinese word 是否 alone is a normal question marker and does not prove a binary response format. Distinguish democracy level, satisfaction with democracy, meaning of democracy, support for democracy, respondent geography, and the country discussed by a question. Shared generic words are insufficient. Statistical capability has already been checked. Never invent a candidate, statistic, answer, or explanation. Use low confidence when the concept remains ambiguous.",
          },
          {
            role: "user",
            content: JSON.stringify(
              {
                request: body.query,
                normalized_search_query: body.normalized_query,
                candidates: candidates.map((candidate, index) => ({
                  index,
                  ...candidate,
                })),
              },
              null,
              0,
            ),
          },
        ],
        tools: [tool],
      }),
    });
    const response = document as {
      model?: unknown;
      done?: unknown;
      message?: {
        tool_calls?: Array<{
          function?: {
            name?: unknown;
            arguments?: {
              candidate_indices?: unknown;
              confidence?: unknown;
            };
          };
        }>;
      };
    };
    const call = response.message?.tool_calls?.find(
      (item) => item.function?.name === "record_question_ranking",
    );
    const indices = call?.function?.arguments?.candidate_indices;
    const confidence = call?.function?.arguments?.confidence;
    if (
      response.model !== MODEL
      || response.done !== true
      || !Array.isArray(indices)
      || !indices.length
      || indices.length > 8
      || !indices.every(
        (index) => Number.isInteger(index) && Number(index) >= 0 && Number(index) <= maximum,
      )
      || new Set(indices).size !== indices.length
      || !["high", "medium", "low"].includes(String(confidence))
    ) {
      throw new Error("Invalid model response");
    }
    return NextResponse.json({
      model: MODEL,
      confidence,
      candidate_ids: indices.map((index) => candidates[Number(index)].variable_id),
      elapsed_ms: Date.now() - started,
    });
  } catch {
    return NextResponse.json({ error: "Local reranking failed." }, { status: 503 });
  } finally {
    activeRequests -= 1;
  }
}
