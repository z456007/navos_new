export interface AccountIdentity {
  uid: string;
  token: string;
}

export type ProviderAuthMode = "uid-token" | "bearer-token" | "none";

export type HeaderBag = Record<string, string | string[] | undefined>;

function getHeader(headers: HeaderBag, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) {
      continue;
    }
    return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

export function isClientAuthorized(headers: HeaderBag, masterApiKey: string): boolean {
  if (!masterApiKey) {
    return false;
  }

  const xApiKey = getHeader(headers, "x-api-key");
  if (xApiKey === masterApiKey) {
    return true;
  }

  const authorization = getHeader(headers, "authorization");
  return authorization === `Bearer ${masterApiKey}`;
}

export function buildProviderAuthHeaders(
  account: AccountIdentity,
  mode: ProviderAuthMode
): Record<string, string> {
  if (mode === "none") {
    return {};
  }
  if (mode === "bearer-token") {
    return { authorization: `Bearer ${account.token}` };
  }
  return { authorization: `Bearer ${account.uid}:${account.token}` };
}

