export const ADMIN_KEY_STORAGE = "navos.admin.apiKey";
const DEFAULT_DEV_API_BASE_URL = "http://127.0.0.1:18888";
const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const API_BASE_URL = (
  configuredApiBaseUrl || (import.meta.env.MODE === "development" ? DEFAULT_DEV_API_BASE_URL : "")
).replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  apiKey: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
    authorization: `Bearer ${apiKey}`
  };
  if (init.body && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(apiUrl(path), {
    ...init,
    headers
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    const message = errorMessage(body) ?? `${response.status} ${response.statusText}`;
    throw new ApiError(message, response.status);
  }

  return body as T;
}

function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  if (!API_BASE_URL) {
    return path;
  }
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function errorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const record = error as { error?: { message?: unknown }; message?: unknown };
  if (typeof record.error?.message === "string") {
    return record.error.message;
  }
  if (typeof record.message === "string") {
    return record.message;
  }
  return undefined;
}
