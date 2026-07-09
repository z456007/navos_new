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

export async function forwardModelRequest<T = unknown>(
  client: ProviderHttpClient,
  request: ModelProxyRequest
): Promise<ProviderResult<T>> {
  if (!ALLOWED_PATHS.has(request.path)) {
    throw new Error(`Unsupported proxy path: ${request.path}`);
  }
  const body = normalizeProxyBody(request.path, request.body);
  if (request.method === "GET") {
    return client.requestJson<T>("GET", request.path, undefined, request.headers);
  }
  return client.requestJson<T>("POST", request.path, body, request.headers);
}

function normalizeProxyBody(path: string, body: unknown): unknown {
  if (path !== "/v1/chat/completions" || !body || typeof body !== "object" || Array.isArray(body)) {
    return body ?? {};
  }

  const normalized: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  if (typeof normalized.model === "string") {
    normalized.model = normalizeModelId(normalized.model);
  }
  if (normalized.max_tokens === undefined && typeof normalized.max_completion_tokens === "number") {
    normalized.max_tokens = normalized.max_completion_tokens;
    delete normalized.max_completion_tokens;
  }
  return normalized;
}

function normalizeModelId(model: string): string {
  if (model.startsWith("claude.opus-")) {
    return model.replace(/^claude\.opus-/, "ospu-");
  }
  if (model.startsWith("claude.sonnet-") || model.startsWith("claude.haiku-")) {
    return model.replace(/^claude\./, "");
  }
  if (model.startsWith("openai.") || model.startsWith("openai/")) {
    return model.replace(/^openai[./]/, "");
  }
  return model;
}
