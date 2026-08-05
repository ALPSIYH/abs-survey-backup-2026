import { NextRequest, NextResponse } from "next/server";

const DEFAULT_LOCAL_ORIGIN = "http://127.0.0.1:8600";
const UPSTREAM_TIMEOUT_MS = 120_000;

function liveApiOrigin(): string {
  const configured = process.env.SURVEY_LIVE_API_ORIGIN?.trim();
  return (configured || DEFAULT_LOCAL_ORIGIN).replace(/\/+$/u, "");
}

async function proxy(request: NextRequest): Promise<NextResponse> {
  const incoming = new URL(request.url);
  const upstream = new URL(`${incoming.pathname}${incoming.search}`, `${liveApiOrigin()}/`);
  const headers = new Headers();
  for (const name of ["accept", "content-type"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer(),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    return new NextResponse(response.body, {
      status: response.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch {
    return NextResponse.json(
      { detail: "The synchronized V8.2 survey service is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
