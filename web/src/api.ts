export const ADMIN_KEY_STORAGE = "navos.admin.apiKey";

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

  const response = await fetch(path, {
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
