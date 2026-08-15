import type { CloudTurnContext, TurnProgram } from "./types";
import { validateTurnProgram } from "./turn-program-contract";

type TurnProgramResolver = (context: CloudTurnContext) => Promise<unknown>;

const TURN_PROGRAM_TIMEOUT_MS = 30_000;
let testResolver: TurnProgramResolver | null = null;

export function setCloudTurnProgramResolverForTests(
  resolver: TurnProgramResolver | null,
): void {
  testResolver = resolver;
}

export function canRequestCloudTurnProgram(): boolean {
  return Boolean(
    testResolver
    || (typeof window !== "undefined" && typeof window.fetch === "function"),
  );
}

export async function requestCloudTurnProgram(
  context: CloudTurnContext,
): Promise<TurnProgram | null> {
  try {
    if (testResolver) {
      return validateTurnProgram(await testResolver(context), context);
    }
    if (typeof window === "undefined" || typeof window.fetch !== "function") return null;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), TURN_PROGRAM_TIMEOUT_MS);
    try {
      const response = await window.fetch("/api/turn-program", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(context),
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return null;
      const document = await response.json() as { program?: unknown };
      return validateTurnProgram(document.program, context);
    } finally {
      window.clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
