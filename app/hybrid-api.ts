import { api as staticApi } from "./api";
import { api as liveApi, isRetryableLiveApiError } from "./live-api";

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

type EmbeddedDataset = Awaited<ReturnType<Backend["bootstrap"]>>["dataset"];

const HEALTH_TIMEOUT_MS = 2_500;
const BRIDGE_RECHECK_MS = 10_000;
let bridgeAvailabilityPromise: Promise<boolean> | null = null;
let bridgeAvailability = { value: false, expiresAt: 0 };
const liveConversationIds = new Set<string>();

export class LocalConversationUnavailableError extends Error {
  constructor() {
    super("The local connection was interrupted. The current result has not been changed.");
    this.name = "LocalConversationUnavailableError";
  }
}

export function isLocalConversationUnavailableError(
  reason: unknown,
): reason is LocalConversationUnavailableError {
  return reason instanceof LocalConversationUnavailableError;
}

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

async function probeBridge(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const [health, embedded] = await Promise.all([
    bridgeHealth(),
    staticApi.bootstrap(),
  ]);
  return bridgeMatchesEmbeddedRelease(health, embedded.dataset);
}

async function bridgeAvailable(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (Date.now() < bridgeAvailability.expiresAt) return bridgeAvailability.value;
  if (!bridgeAvailabilityPromise) {
    bridgeAvailabilityPromise = probeBridge()
      .catch(() => false)
      .then((value) => {
        bridgeAvailability = { value, expiresAt: Date.now() + BRIDGE_RECHECK_MS };
        bridgeAvailabilityPromise = null;
        return value;
      });
  }
  return bridgeAvailabilityPromise;
}

function invalidateBridge(): void {
  bridgeAvailability = { value: false, expiresAt: 0 };
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
  if (await bridgeAvailable()) {
    try {
      const response = await liveApi.createConversation();
      liveConversationIds.add(response.conversation_id);
      return response;
    } catch (reason) {
      if (!isRetryableLiveApiError(reason)) throw reason;
      invalidateBridge();
    }
  }
  return staticApi.createConversation();
}

async function continueConversation<T>(
  conversationId: string,
  liveRequest: () => Promise<T>,
  staticRequest: () => Promise<T>,
): Promise<T> {
  if (!liveConversationIds.has(conversationId)) return staticRequest();
  try {
    return await liveRequest();
  } catch (reason) {
    if (!isRetryableLiveApiError(reason)) throw reason;
    invalidateBridge();
    throw new LocalConversationUnavailableError();
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
