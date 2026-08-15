/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  SURVEY_V82_API?: Fetcher;
  SURVEY_LIVE_API_TOKEN?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const LOCAL_API_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 128_000;
const RETRYABLE_LOCAL_STATUS_CODES = new Set([502, 503, 504]);

function staticCacheControl(request: Request): string {
  const url = new URL(request.url);
  if (/^\/assets\/[a-z0-9_-]+\.[a-z0-9]+$/iu.test(url.pathname)) {
    return "public, max-age=31536000, immutable";
  }
  if (
    /^\/data\/(?:questions|response-sets)\/[a-z0-9._-]+\.json$/iu.test(url.pathname)
    && /^[a-f0-9]{12,64}$/iu.test(url.searchParams.get("release") ?? "")
  ) {
    return "public, max-age=31536000, immutable";
  }
  if (url.pathname === "/icon.svg") return "public, max-age=86400";
  return "public, max-age=0, must-revalidate";
}

function withStaticCache(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", staticCacheControl(request));
  return new Response(request.method === "HEAD" ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function serveIndependentStaticSite(
  request: Request,
  assets: Fetcher,
): Promise<Response | null> {
  const direct = await assets.fetch(request);
  if (direct.status !== 404) return withStaticCache(request, direct);

  const acceptsHtml = request.headers.get("accept")?.includes("text/html") ?? true;
  if (!acceptsHtml) return direct;
  const indexUrl = new URL(request.url);
  indexUrl.pathname = "/index.html";
  indexUrl.search = "";
  const index = await assets.fetch(new Request(indexUrl, request));
  return index.status === 404 ? null : withStaticCache(request, index);
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

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function tryLocalV82(request: Request, env: Env): Promise<Response | null> {
  const binding = env.SURVEY_V82_API;
  const token = env.SURVEY_LIVE_API_TOKEN?.trim();
  if (!binding || !token || !sameOrigin(request)) return null;

  const incoming = new URL(request.url);
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return Response.json(
      { detail: "The bridge request is too large." },
      { status: 413, headers: { "Cache-Control": "no-store" } },
    );
  }

  const headers = new Headers();
  for (const name of ["accept", "content-type"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Authorization", `Bearer ${token}`);

  try {
    const body = request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.clone().arrayBuffer();
    if (body && body.byteLength > MAX_BODY_BYTES) {
      return Response.json(
        { detail: "The bridge request is too large." },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      );
    }
    const upstream = new Request(
      `http://survey-v82.internal${incoming.pathname}${incoming.search}`,
      {
        method: request.method,
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(LOCAL_API_TIMEOUT_MS),
      },
    );
    const response = await binding.fetch(upstream);
    if (RETRYABLE_LOCAL_STATUS_CODES.has(response.status)) return null;
    const responseHeaders = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": response.headers.get("content-type") ?? "application/json",
    });
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) responseHeaders.set("Retry-After", retryAfter);
    if (response.ok) {
      responseHeaders.set("X-Survey-Execution", "local");
      responseHeaders.set("X-Survey-Channel", "backup-local");
    }
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch {
    return null;
  }
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/v1/")) {
      if (!isAllowedRequest(request.method, url.pathname)) {
        return Response.json(
          { detail: "This bridge request is not allowed." },
          { status: 403, headers: { "Cache-Control": "no-store" } },
        );
      }
      const localResponse = await tryLocalV82(request, env);
      if (localResponse) return localResponse;
    }

    if (
      (request.method === "GET" || request.method === "HEAD")
      && !url.pathname.startsWith("/api/")
      && url.pathname !== "/_vinext/image"
    ) {
      const staticResponse = await serveIndependentStaticSite(request, env.ASSETS);
      if (staticResponse) return staticResponse;
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
