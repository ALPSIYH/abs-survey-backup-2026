import { api as staticApi } from "./api";
import { api as liveApi } from "./live-api";

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

function isIndependentStaticBuild(): boolean {
  if (typeof document === "undefined") return true;
  return document.querySelector<HTMLMetaElement>(
    'meta[name="survey-runtime"][content="static-independent"]',
  ) !== null;
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
  if (isIndependentStaticBuild() || typeof window === "undefined") return false;
  const [health, embedded] = await Promise.all([
    bridgeHealth(),
    staticApi.bootstrap(),
  ]);
  return bridgeMatchesEmbeddedRelease(health, embedded.dataset);
}

async function bridgeAvailable(): Promise<boolean> {
  if (isIndependentStaticBuild() || typeof window === "undefined") return false;
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
    } catch {
      invalidateBridge();
    }
  }
  return fallback();
}

async function fallbackConversationMessage(
  conversationId: string,
  message: string,
  expectedRevision: number,
) {
  try {
    return await staticApi.sendConversationMessage(
      conversationId,
      message,
      expectedRevision,
    );
  } catch {
    const replacement = await staticApi.createConversation();
    return staticApi.sendConversationMessage(
      replacement.conversation_id,
      message,
      replacement.revision,
    );
  }
}

export const api: Backend = {
  bootstrap: () => preferLocalV82(liveApi.bootstrap, staticApi.bootstrap),
  catalogSearch: (...args) => preferLocalV82(
    () => liveApi.catalogSearch(...args),
    () => staticApi.catalogSearch(...args),
  ),
  question: (...args) => preferLocalV82(
    () => liveApi.question(...args),
    () => staticApi.question(...args),
  ),
  responseSet: (...args) => preferLocalV82(
    () => liveApi.responseSet(...args),
    () => staticApi.responseSet(...args),
  ),
  assistantStatus: () => preferLocalV82(
    liveApi.assistantStatus,
    staticApi.assistantStatus,
  ),
  analyze: (...args) => preferLocalV82(
    () => liveApi.analyze(...args),
    () => staticApi.analyze(...args),
  ),
  validate: (...args) => preferLocalV82(
    () => liveApi.validate(...args),
    () => staticApi.validate(...args),
  ),
  assistantPlan: (...args) => preferLocalV82(
    () => liveApi.assistantPlan(...args),
    () => staticApi.assistantPlan(...args),
  ),
  createConversation: () => preferLocalV82(
    liveApi.createConversation,
    staticApi.createConversation,
  ),
  sendConversationMessage: (...args) => preferLocalV82(
    () => liveApi.sendConversationMessage(...args),
    () => fallbackConversationMessage(...args),
  ),
  sendConversationCommand: (...args) => preferLocalV82(
    () => liveApi.sendConversationCommand(...args),
    () => staticApi.sendConversationCommand(...args),
  ),
  startNewQuestion: (...args) => preferLocalV82(
    () => liveApi.startNewQuestion(...args),
    () => staticApi.startNewQuestion(...args),
  ),
};
