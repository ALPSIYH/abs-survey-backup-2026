import { api as staticApi } from "./api";
import { api as liveApi, isRetryableLiveApiError } from "./live-api";
import type { ConversationResponse } from "./types";

type Backend = typeof staticApi;

interface BridgeHealth {
  status?: unknown;
  release?: {
    data_release?: unknown;
    data_transaction?: unknown;
    data_fingerprint?: unknown;
    model_release?: unknown;
  };
}

type EmbeddedBootstrap = Awaited<ReturnType<Backend["bootstrap"]>>;
type EmbeddedDataset = EmbeddedBootstrap["dataset"];
interface BridgeBootstrap {
  dataset?: { question_count?: unknown };
  questions?: Array<{ variable_id?: unknown }>;
  response_sets?: Array<{ response_set_id?: unknown }>;
}

const HEALTH_TIMEOUT_MS = 8_000;
const BRIDGE_RECHECK_MS = 10_000;
const BRIDGE_CONFIRMATION_DELAY_MS = 600;
const BRIDGE_CONFIRMATION_ATTEMPTS = 2;
let bridgeAvailabilityPromise: Promise<boolean> | null = null;
let bridgeAvailability = { value: false, expiresAt: 0 };
type ConversationRoute = "local" | "cloud";
const conversationRoutes = new Map<string, ConversationRoute>();
const conversationMirrors = new Map<string, ConversationResponse>();

async function bridgeHealth(): Promise<BridgeHealth | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await window.fetch("/api/v1/health", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
      return null;
    }
    return await response.json() as BridgeHealth;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

async function bridgeBootstrap(): Promise<BridgeBootstrap | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await window.fetch("/api/v1/bootstrap", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
      return null;
    }
    return await response.json() as BridgeBootstrap;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export function bridgeMatchesEmbeddedRelease(
  health: BridgeHealth | null,
  embedded: EmbeddedDataset,
): boolean {
  const release = health?.release;
  const modelRelease = String(release?.model_release ?? "");
  const fingerprint = String(release?.data_fingerprint ?? "");
  return (
    health?.status === "ready"
    && release?.data_transaction === embedded.release_transaction
    && release?.data_release === embedded.release_correction
    && Boolean(embedded.release_fingerprint)
    && embedded.release_fingerprint?.startsWith(fingerprint) === true
    && fingerprint.length >= 12
    && /^v8\.2(?:-|$)/u.test(modelRelease)
  );
}

export function bridgeMatchesEmbeddedContract(
  live: BridgeBootstrap | null,
  embedded: EmbeddedBootstrap,
): boolean {
  if (!live || live.dataset?.question_count !== embedded.dataset.question_count) return false;
  const liveQuestions = (live.questions ?? []).map((item) => String(item.variable_id ?? "")).sort();
  const embeddedQuestions = embedded.questions.map((item) => item.variable_id).sort();
  const liveResponseSets = (live.response_sets ?? [])
    .map((item) => String(item.response_set_id ?? ""))
    .sort();
  const embeddedResponseSets = embedded.response_sets.map((item) => item.response_set_id).sort();
  return (
    liveQuestions.length === embeddedQuestions.length
    && liveQuestions.every((item, index) => item === embeddedQuestions[index])
    && liveResponseSets.length === embeddedResponseSets.length
    && liveResponseSets.every((item, index) => item === embeddedResponseSets[index])
  );
}

async function probeBridge(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const embedded = await staticApi.bootstrap();
  const health = await bridgeHealth();
  if (!bridgeMatchesEmbeddedRelease(health, embedded.dataset)) return false;
  const live = await bridgeBootstrap();
  return (
    bridgeMatchesEmbeddedContract(live, embedded)
  );
}

function rememberBridgeAvailability(value: boolean): void {
  bridgeAvailability = { value, expiresAt: Date.now() + BRIDGE_RECHECK_MS };
}

async function bridgeAvailable(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (Date.now() < bridgeAvailability.expiresAt) return bridgeAvailability.value;
  if (!bridgeAvailabilityPromise) {
    bridgeAvailabilityPromise = probeBridge()
      .catch(() => false)
      .then((value) => {
        rememberBridgeAvailability(value);
        bridgeAvailabilityPromise = null;
        return value;
      });
  }
  return bridgeAvailabilityPromise;
}

function invalidateBridge(): void {
  bridgeAvailability = { value: false, expiresAt: 0 };
}

async function waitForBridgeConfirmation(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, BRIDGE_CONFIRMATION_DELAY_MS);
  });
}

export async function outageConfirmedAfterChecks(
  checkAvailable: () => Promise<boolean>,
  pause: () => Promise<void> = waitForBridgeConfirmation,
): Promise<boolean> {
  for (let attempt = 0; attempt < BRIDGE_CONFIRMATION_ATTEMPTS; attempt += 1) {
    try {
      if (await checkAvailable()) return false;
    } catch {
      // A failed check counts as unavailable, but one failure never triggers takeover.
    }
    if (attempt + 1 < BRIDGE_CONFIRMATION_ATTEMPTS) await pause();
  }
  return true;
}

async function bridgeReleaseAvailable(): Promise<boolean> {
  const [health, embedded] = await Promise.all([
    bridgeHealth(),
    staticApi.bootstrap(),
  ]);
  return bridgeMatchesEmbeddedRelease(health, embedded.dataset);
}

async function confirmBridgeUnavailable(): Promise<boolean> {
  const unavailable = await outageConfirmedAfterChecks(bridgeReleaseAvailable);
  rememberBridgeAvailability(!unavailable);
  return unavailable;
}

async function bridgeAvailableWithGrace(): Promise<boolean> {
  if (await bridgeAvailable()) return true;
  await waitForBridgeConfirmation();
  const available = await probeBridge().catch(() => false);
  rememberBridgeAvailability(available);
  return available;
}

async function preferLocalV82<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  if (await bridgeAvailable()) {
    try {
      return await primary();
    } catch (reason) {
      if (!isRetryableLiveApiError(reason)) throw reason;
      invalidateBridge();
    }
  }
  return fallback();
}

async function createConversation() {
  if (await bridgeAvailableWithGrace()) {
    try {
      const response: ConversationResponse = {
        ...await liveApi.createConversation(),
        execution_mode: "local",
      };
      conversationRoutes.set(response.conversation_id, "local");
      conversationMirrors.set(response.conversation_id, response);
      return response;
    } catch (reason) {
      if (!isRetryableLiveApiError(reason)) throw reason;
      invalidateBridge();
      if (!(await confirmBridgeUnavailable())) throw reason;
    }
  }
  const response: ConversationResponse = {
    ...await staticApi.createConversation(),
    execution_mode: "cloud",
  };
  conversationRoutes.set(response.conversation_id, "cloud");
  conversationMirrors.set(response.conversation_id, response);
  return response;
}

async function continueConversation(
  conversationId: string,
  liveRequest: () => Promise<ConversationResponse>,
  cloudRequest: () => Promise<ConversationResponse>,
): Promise<ConversationResponse> {
  if (conversationRoutes.get(conversationId) !== "local") {
    const response = { ...await cloudRequest(), execution_mode: "cloud" as const };
    conversationRoutes.set(conversationId, "cloud");
    conversationMirrors.set(conversationId, response);
    return response;
  }
  try {
    const response = { ...await liveRequest(), execution_mode: "local" as const };
    conversationMirrors.set(conversationId, response);
    return response;
  } catch (reason) {
    if (!isRetryableLiveApiError(reason)) throw reason;
    invalidateBridge();
    if (!(await confirmBridgeUnavailable())) throw reason;
    const mirror = conversationMirrors.get(conversationId);
    if (!mirror) {
      throw new Error("The conversation could not be recovered after the local connection was interrupted.");
    }
    staticApi.importConversation(mirror);
    conversationRoutes.set(conversationId, "cloud");
    const response = { ...await cloudRequest(), execution_mode: "cloud" as const };
    conversationMirrors.set(conversationId, response);
    return response;
  }
}

export const api: Backend = {
  // Immutable aggregate data ships with the verified ACTIVE release, so data
  // views render immediately and remain available when the Mac is offline.
  // Model-backed operations below still prefer the dedicated local V8.2 API.
  bootstrap: staticApi.bootstrap,
  catalogSearch: (...args) => preferLocalV82(
    () => liveApi.catalogSearch(...args),
    () => staticApi.catalogSearch(...args),
  ),
  question: staticApi.question,
  responseSet: staticApi.responseSet,
  assistantStatus: () => preferLocalV82(
    liveApi.assistantStatus,
    staticApi.assistantStatus,
  ),
  analyze: staticApi.analyze,
  validate: staticApi.validate,
  assistantPlan: (...args) => preferLocalV82(
    () => liveApi.assistantPlan(...args),
    () => staticApi.assistantPlan(...args),
  ),
  importConversation: staticApi.importConversation,
  createConversation,
  sendConversationMessage: (...args) => continueConversation(
    args[0],
    () => liveApi.sendConversationMessage(...args),
    () => staticApi.sendConversationMessage(...args),
  ),
  sendConversationCommand: (...args) => continueConversation(
    args[0],
    () => liveApi.sendConversationCommand(...args),
    () => staticApi.sendConversationCommand(...args),
  ),
  startNewQuestion: (...args) => continueConversation(
    args[0],
    () => liveApi.startNewQuestion(...args),
    () => staticApi.startNewQuestion(...args),
  ),
};
