import type { AccountIdentity, ProviderAuthMode } from "../protocols/auth.js";
import type { YydsDomainPoolConfig, YydsDomainPoolMode } from "../store/yyds-domain-pool-store.js";

export interface AppConfig {
  masterApiKey: string;
  publicProxyApiKeys: string[];
  providerBaseUrl: string;
  providerAuthMode: ProviderAuthMode;
  listenPort: number;
  mysql: MysqlEnvConfig;
  defaultAccount?: AccountIdentity;
  vipBaseUrl: string;
  vipHmacSecret: string;
  poolTargetSize: number;
  registrationConcurrency: number;
  registrationMaxInFlight: number;
  registrationMailboxCreateConcurrency: number;
  registrationMailboxCreatePerSecond: number;
  registrationVipSendConcurrency: number;
  registrationPollConcurrency: number;
  registrationLoginConcurrency: number;
  registrationCertConcurrency: number;
  registrationVerificationTimeoutMs: number;
  redisUrl: string;
  queuePrefix: string;
  registrationJobConcurrency: number;
  registrationJobRemoveOnComplete: number;
  registrationJobRemoveOnFail: number;
  imageAccountWaitMs: number;
  imageMaxPollAttempts: number;
  imagePollIntervalMs: number;
  yydsDomainPool: YydsDomainPoolConfig;
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
const SMALL_SERVER_REGISTRATION_JOB_CONCURRENCY = 1;

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

function parseCappedPositiveInt(value: string | undefined, fallback: number, max: number): number {
  return Math.min(parsePositiveInt(value, fallback), max);
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  return fallback;
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDomainPoolMode(value: string | undefined): YydsDomainPoolMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "auto" || normalized === "whitelist" || normalized === "auto-plus-whitelist") {
    return normalized;
  }
  return "auto-plus-whitelist";
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
    registrationMaxInFlight: parseCappedPositiveInt(env.REGISTRATION_MAX_IN_FLIGHT, 6, 20),
    registrationMailboxCreateConcurrency: parseCappedPositiveInt(env.REGISTRATION_MAILBOX_CREATE_CONCURRENCY, 2, 5),
    registrationMailboxCreatePerSecond: parseCappedPositiveInt(env.REGISTRATION_MAILBOX_CREATE_PER_SECOND, 2, 10),
    registrationVipSendConcurrency: parseCappedPositiveInt(env.REGISTRATION_VIP_SEND_CONCURRENCY, 6, 20),
    registrationPollConcurrency: parseCappedPositiveInt(env.REGISTRATION_POLL_CONCURRENCY, 30, 100),
    registrationLoginConcurrency: parseCappedPositiveInt(env.REGISTRATION_LOGIN_CONCURRENCY, 6, 20),
    registrationCertConcurrency: parseCappedPositiveInt(env.REGISTRATION_CERT_CONCURRENCY, 4, 20),
    registrationVerificationTimeoutMs: parsePositiveInt(env.REGISTRATION_VERIFICATION_TIMEOUT_MS, 90_000),
    redisUrl: env.REDIS_URL?.trim() || "redis://127.0.0.1:6379",
    queuePrefix: env.QUEUE_PREFIX?.trim() || "navos",
    registrationJobConcurrency: Math.min(
      parsePositiveInt(env.REGISTRATION_JOB_CONCURRENCY, SMALL_SERVER_REGISTRATION_JOB_CONCURRENCY),
      SMALL_SERVER_REGISTRATION_JOB_CONCURRENCY
    ),
    registrationJobRemoveOnComplete: parsePositiveInt(env.REGISTRATION_JOB_REMOVE_ON_COMPLETE, 50),
    registrationJobRemoveOnFail: parsePositiveInt(env.REGISTRATION_JOB_REMOVE_ON_FAIL, 100),
    imageAccountWaitMs: parsePositiveInt(env.IMAGE_ACCOUNT_WAIT_MS, 120_000),
    imageMaxPollAttempts: parsePositiveInt(env.IMAGE_MAX_POLL_ATTEMPTS, 30),
    imagePollIntervalMs: parsePositiveInt(env.IMAGE_POLL_INTERVAL_MS, 4_000),
    yydsDomainPool: {
      enabled: parseBool(env.YYDS_DOMAIN_POOL_ENABLED, true),
      mode: parseDomainPoolMode(env.YYDS_DOMAIN_POOL_MODE),
      whitelist: parseCsv(env.YYDS_DOMAIN_WHITELIST).map((item) => item.toLowerCase()),
      blacklist: parseCsv(env.YYDS_DOMAIN_BLACKLIST).map((item) => item.toLowerCase()),
      refreshIntervalMinutes: parsePositiveInt(env.YYDS_DOMAIN_REFRESH_MINUTES, 30)
    }
  };
}
