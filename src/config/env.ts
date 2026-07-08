import type { AccountIdentity, ProviderAuthMode } from "../protocols/auth.js";

export interface AppConfig {
  masterApiKey: string;
  providerBaseUrl: string;
  providerAuthMode: ProviderAuthMode;
  listenPort: number;
  defaultAccount?: AccountIdentity;
}

type EnvInput = Record<string, string | undefined>;

function requireEnv(env: EnvInput, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseProviderAuthMode(value: string | undefined): ProviderAuthMode {
  if (!value) {
    return "uid-token";
  }
  if (value === "uid-token" || value === "bearer-token" || value === "none") {
    return value;
  }
  throw new Error(`Unsupported PROVIDER_AUTH_MODE: ${value}`);
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return 18888;
  }
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return port;
}

export function loadConfig(env: EnvInput = process.env): AppConfig {
  const uid = env.PROVIDER_ACCOUNT_UID?.trim();
  const token = env.PROVIDER_ACCOUNT_TOKEN?.trim();
  const defaultAccount = uid && token ? { uid, token } : undefined;

  return {
    masterApiKey: requireEnv(env, "MASTER_API_KEY"),
    providerBaseUrl: requireEnv(env, "PROVIDER_BASE_URL").replace(/\/+$/, ""),
    providerAuthMode: parseProviderAuthMode(env.PROVIDER_AUTH_MODE),
    listenPort: parsePort(env.PORT),
    defaultAccount
  };
}

