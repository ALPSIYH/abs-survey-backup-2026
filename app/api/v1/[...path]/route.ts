import { NextRequest, NextResponse } from "next/server";

const HEALTH_TIMEOUT_MS = 2_500;
const OPERATION_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 128_000;

function liveApiOrigin(): URL | null {
  const configured = process.env.SURVEY_LIVE_API_ORIGIN?.trim();
  if (!configured) return null;
  try {
    const origin = new URL(configured);
    if (
      !["http:", "https:"].includes(origin.protocol)
      || origin.username
      || origin.password
      || origin.search
      || origin.hash
    ) return null;
    origin.pathname = `${origin.pathname.replace(/\/+$/u, "")}/`;
    return origin;
  } catch {
    return null;
  }
}

function isAllowedRequest(method: string, pathname: string): boolean {
  if (method === "GET") {
    return [
      /^\/api\/v1\/(?:health|bootstrap|assistant\/status)$/u,
      /^\/api\/v1\/(?:questions|response-sets)\/q?[a-z0-9._-]+$/iu,
    ].some((pattern) => pattern.test(pathname));
  }
  if (method !== "POST") return false;
  return [
    /^\/api\/v1\/(?:catalog\/search|analyses|drafts\/validate|assistant\/plans)$/u,
    /^\/api\/v1\/conversations$/u,
    /^\/api\/v1\/conversations\/[a-z0-9_-]+\/(?:messages|new-question)$/iu,
  ].some((pattern) => pattern.test(pathname));
}

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function proxy(request: NextRequest): Promise<NextResponse> {
  const incoming = new URL(request.url);
  const origin = liveApiOrigin();
  const token = process.env.SURVEY_LIVE_API_TOKEN?.trim();
  if (!origin || !token) {
    return NextResponse.json(
      { detail: "The local survey service is not configured; cloud and deterministic analysis remain available." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!isAllowedRequest(request.method, incoming.pathname) || !isSameOrigin(request)) {
    return NextResponse.json(
      { detail: "This bridge request is not allowed." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { detail: "The bridge request is too large." },
      { status: 413, headers: { "Cache-Control": "no-store" } },
    );
  }
  const upstream = new URL(`${incoming.pathname}${incoming.search}`, origin);
  const headers = new Headers();
  for (const name of ["accept", "content-type"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Authorization", `Bearer ${token}`);

  try {
    const body = request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer();
    if (body && body.byteLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { detail: "The bridge request is too large." },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      );
    }
    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(
        incoming.pathname === "/api/v1/health" ? HEALTH_TIMEOUT_MS : OPERATION_TIMEOUT_MS,
      ),
    });
    const responseHeaders: Record<string, string> = {
      "Cache-Control": "no-store",
      "Content-Type": response.headers.get("content-type") ?? "application/json",
    };
    if (response.ok) {
      Object.assign(responseHeaders, {
        "X-Survey-Execution": "local",
        "X-Survey-Channel": "formal-local",
      });
    }
    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch {
    return NextResponse.json(
      { detail: "The local survey service is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
