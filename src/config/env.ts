import type { AccountIdentity, ProviderAuthMode } from "../protocols/auth.js";

export interface AppConfig {
  masterApiKey: string;
  publicProxyApiKeys: string[];
  providerBaseUrl: string;
  providerAuthMode: ProviderAuthMode;
  listenPort: number;
  cosConfigSecret?: string;
  mysql: MysqlEnvConfig;
  defaultAccount?: AccountIdentity;
  vipBaseUrl: string;
  vipHmacSecret: string;
  poolTargetSize: number;
  registrationConcurrency: number;
  redisUrl: string;
  queuePrefix: string;
  registrationJobConcurrency: number;
  registrationJobRemoveOnComplete: number;
  registrationJobRemoveOnFail: number;
}

export interface MysqlEnvConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

type EnvInput = Record<string, string | undefined>;
const YYDS_SAFE_REGISTRATION_CONCURRENCY = 2;

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

function parseMysqlPort(value: string | undefined): number {
  if (!value) {
    return 3306;
  }
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid MYSQL_PORT: ${value}`);
  }
  return port;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 0) {
    return fallback;
  }
  return n;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1) {
    return fallback;
  }
  return n;
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadConfig(env: EnvInput = process.env): AppConfig {
  const uid = env.PROVIDER_ACCOUNT_UID?.trim();
  const token = env.PROVIDER_ACCOUNT_TOKEN?.trim();
  const defaultAccount = uid && token ? { uid, token } : undefined;

  return {
    masterApiKey: requireEnv(env, "MASTER_API_KEY"),
    publicProxyApiKeys: parseCsv(env.PUBLIC_PROXY_API_KEYS),
    providerBaseUrl: requireEnv(env, "PROVIDER_BASE_URL").replace(/\/+$/, ""),
    providerAuthMode: parseProviderAuthMode(env.PROVIDER_AUTH_MODE),
    listenPort: parsePort(env.PORT),
    cosConfigSecret: env.COS_CONFIG_SECRET?.trim() || undefined,
    mysql: {
      host: env.MYSQL_HOST?.trim() || "127.0.0.1",
      port: parseMysqlPort(env.MYSQL_PORT),
      user: env.MYSQL_USER?.trim() || "root",
      password: env.MYSQL_PASSWORD ?? "",
      database: env.MYSQL_DATABASE?.trim() || "navos_new"
    },
    defaultAccount,
    vipBaseUrl: (env.VIP_BASE_URL?.trim() || "https://navos-mind-server-vip.tec-do.com").replace(/\/+$/, ""),
    vipHmacSecret: requireEnv(env, "VIP_HMAC_SECRET"),
    poolTargetSize: parseNonNegativeInt(env.POOL_TARGET_SIZE, 0),
    registrationConcurrency: Math.min(
      parsePositiveInt(env.REGISTRATION_CONCURRENCY, YYDS_SAFE_REGISTRATION_CONCURRENCY),
      YYDS_SAFE_REGISTRATION_CONCURRENCY
    ),
    redisUrl: env.REDIS_URL?.trim() || "redis://127.0.0.1:6379",
    queuePrefix: env.QUEUE_PREFIX?.trim() || "navos",
    registrationJobConcurrency: parsePositiveInt(env.REGISTRATION_JOB_CONCURRENCY, 2),
    registrationJobRemoveOnComplete: parsePositiveInt(env.REGISTRATION_JOB_REMOVE_ON_COMPLETE, 50),
    registrationJobRemoveOnFail: parsePositiveInt(env.REGISTRATION_JOB_REMOVE_ON_FAIL, 100)
  };
}
