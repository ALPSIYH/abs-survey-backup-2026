import type {
  AnalysisEnvelope,
  AssistantPlanResponse,
  AssistantStatus,
  Bootstrap,
  CatalogSearchResponse,
  ConversationCommand,
  ConversationResponse,
  Draft,
  QuestionDetail,
  ResponseSetDetail,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(
      typeof body?.detail === "string" ? body.detail : "The live survey service is unavailable.",
    );
  }
  return response.json() as Promise<T>;
}

export const api = {
  bootstrap: () => request<Bootstrap>("/api/v1/bootstrap"),
  catalogSearch: (query: string, limit = 20) =>
    request<CatalogSearchResponse>("/api/v1/catalog/search", {
      method: "POST",
      body: JSON.stringify({ query, limit }),
    }),
  question: (id: string) =>
    request<QuestionDetail>(`/api/v1/questions/${encodeURIComponent(id)}`),
  responseSet: (id: string) =>
    request<ResponseSetDetail>(`/api/v1/response-sets/${encodeURIComponent(id)}`),
  assistantStatus: () => request<AssistantStatus>("/api/v1/assistant/status"),
  analyze: (draft: Draft) =>
    request<AnalysisEnvelope>("/api/v1/analyses", {
      method: "POST",
      body: JSON.stringify(draft),
    }),
  validate: (draft: Draft) =>
    request<{
      valid: true;
      request: { target_id: string | null; countries: number[]; waves: number[] };
    }>("/api/v1/drafts/validate", {
      method: "POST",
      body: JSON.stringify(draft),
    }),
  assistantPlan: (prompt: string, draft: Draft) =>
    request<AssistantPlanResponse>("/api/v1/assistant/plans", {
      method: "POST",
      body: JSON.stringify({ prompt, draft }),
    }),
  createConversation: () =>
    request<ConversationResponse>("/api/v1/conversations", { method: "POST" }),
  sendConversationMessage: (
    conversationId: string,
    message: string,
    expectedRevision: number,
  ) =>
    request<ConversationResponse>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          expected_revision: expectedRevision,
          input: { type: "text", message },
        }),
      },
    ),
  sendConversationCommand: (
    conversationId: string,
    command: ConversationCommand,
    expectedRevision: number,
    displayLabel?: string,
  ) =>
    request<ConversationResponse>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          expected_revision: expectedRevision,
          input: { type: "command", command, display_label: displayLabel },
        }),
      },
    ),
  startNewQuestion: (conversationId: string) =>
    request<ConversationResponse>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/new-question`,
      { method: "POST" },
    ),
};
