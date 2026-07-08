import type { ProviderResult } from "./http.js";
import { ProviderHttpClient } from "./http.js";

export interface ModelProxyRequest {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  headers: Record<string, string>;
}

const ALLOWED_PATHS = new Set([
  "/v1/models",
  "/v1/chat/completions",
  "/v1/messages"
]);

function upstreamPath(path: string): string {
  if (path === "/v1/chat/completions") {
    return "/chat/completions";
  }
  return path;
}

export async function forwardModelRequest<T = unknown>(
  client: ProviderHttpClient,
  request: ModelProxyRequest
): Promise<ProviderResult<T>> {
  if (!ALLOWED_PATHS.has(request.path)) {
    throw new Error(`Unsupported proxy path: ${request.path}`);
  }
  const path = upstreamPath(request.path);
  if (request.method === "GET") {
    return client.requestJson<T>("GET", path, undefined, request.headers);
  }
  return client.requestJson<T>("POST", path, request.body ?? {}, request.headers);
}
