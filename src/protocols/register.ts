import type { ProviderResult } from "./http.js";
import { ProviderHttpClient } from "./http.js";

export async function registerAccount<T = unknown>(
  client: ProviderHttpClient,
  payload: Record<string, unknown>,
  headers: Record<string, string>
): Promise<ProviderResult<T>> {
  return client.requestJson<T>("POST", "/api/register", payload, headers);
}

