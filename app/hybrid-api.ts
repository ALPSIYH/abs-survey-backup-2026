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
let backendPromise: Promise<Backend> | null = null;

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

async function selectBackend(): Promise<Backend> {
  if (isIndependentStaticBuild() || typeof window === "undefined") return staticApi;
  const [health, embedded] = await Promise.all([
    bridgeHealth(),
    staticApi.bootstrap(),
  ]);
  return bridgeMatchesEmbeddedRelease(health, embedded.dataset)
    ? liveApi as Backend
    : staticApi;
}

function backend(): Promise<Backend> {
  if (!backendPromise) backendPromise = selectBackend();
  return backendPromise;
}

export const api: Backend = {
  bootstrap: async () => (await backend()).bootstrap(),
  catalogSearch: async (...args) => (await backend()).catalogSearch(...args),
  question: async (...args) => (await backend()).question(...args),
  responseSet: async (...args) => (await backend()).responseSet(...args),
  assistantStatus: async () => (await backend()).assistantStatus(),
  analyze: async (...args) => (await backend()).analyze(...args),
  validate: async (...args) => (await backend()).validate(...args),
  assistantPlan: async (...args) => (await backend()).assistantPlan(...args),
  createConversation: async () => (await backend()).createConversation(),
  sendConversationMessage: async (...args) =>
    (await backend()).sendConversationMessage(...args),
  sendConversationCommand: async (...args) =>
    (await backend()).sendConversationCommand(...args),
  startNewQuestion: async (...args) => (await backend()).startNewQuestion(...args),
};
