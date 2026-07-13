import type { AccountIdentity, ProviderAuthMode } from "../protocols/auth.js";
import type { AccountBalanceReconcileScope } from "../services/runtime-config-schema.js";
import { normalizeYydsDomainPoolConfig } from "../services/yyds-domain-pool.js";
import type { MysqlConfig as MysqlEnvConfig } from "../store/mysql-config.js";
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
  imageAllowVideoReserveFallback: boolean;
  accountBalanceReconcileEnabled: boolean;
  accountBalanceReconcileIntervalMinutes: number;
  accountBalanceReconcileBatchSize: number;
  accountBalanceReconcileConcurrency: number;
  accountBalanceReconcileScope: AccountBalanceReconcileScope;
  registrationYydsQuotaBlockSeconds: number;
  yydsDomainPool: YydsDomainPoolConfig;
}


type EnvInput = Record<string, string | undefined>;
const DEFAULT_REGISTRATION_CONCURRENCY = 20;
const DEFAULT_REGISTRATION_JOB_CONCURRENCY = 20;
const REGISTRATION_CONCURRENCY_CAP = 5000;
const REGISTRATION_MAX_IN_FLIGHT_CAP = 100000;
const REGISTRATION_MAILBOX_CREATE_CONCURRENCY_CAP = 5000;
const REGISTRATION_MAILBOX_CREATE_PER_SECOND_CAP = 5000;
const REGISTRATION_VIP_SEND_CONCURRENCY_CAP = 5000;
const REGISTRATION_POLL_CONCURRENCY_CAP = 5000;
const REGISTRATION_LOGIN_CONCURRENCY_CAP = 5000;
const REGISTRATION_CERT_CONCURRENCY_CAP = 5000;
const ACCOUNT_BALANCE_RECONCILE_CONCURRENCY_CAP = 500;

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

function parseStrictBool(value: string | undefined, fallback: boolean, name: string): boolean {
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
  throw new Error(`Invalid ${name}: ${value}`);
}


function parseAccountBalanceReconcileScope(value: string | undefined): AccountBalanceReconcileScope {
  const normalized = value?.trim();
  if (normalized === "active" || normalized === "non_disabled" || normalized === "all" || normalized === "depleted") {
    return normalized;
  }
  return "depleted";
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
  if (value?.trim()) {
    return normalized as YydsDomainPoolMode;
  }
  return "auto-plus-whitelist";
}

function parseYydsDomainRefreshIntervalMinutes(value: string | undefined): number {
  if (!value?.trim()) {
    return 30;
  }
  const normalized = value.trim();
  return /^\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
}

export function loadConfig(env: EnvInput = process.env): AppConfig {
  const uid = env.PROVIDER_ACCOUNT_UID?.trim();
  const token = env.PROVIDER_ACCOUNT_TOKEN?.trim();
  const defaultAccount = uid && token ? { uid, token } : undefined;
  const masterApiKey = requireEnv(env, "MASTER_API_KEY");
  const publicProxyApiKeys = parseCsv(env.PUBLIC_PROXY_API_KEYS);

  if (publicProxyApiKeys.includes(masterApiKey)) {
    throw new Error("PUBLIC_PROXY_API_KEYS must not include MASTER_API_KEY");
  }

  return {
    masterApiKey,
    publicProxyApiKeys,
    providerBaseUrl: requireEnv(env, "PROVIDER_BASE_URL").replace(/\/+$/, ""),
    providerAuthMode: parseProviderAuthMode(env.PROVIDER_AUTH_MODE),
    listenPort: parsePort(env.PORT),
    mysql: {
      host: env.MYSQL_HOST?.trim() || "127.0.0.1",
      port: parseMysqlPort(env.MYSQL_PORT),
      user: env.MYSQL_USER?.trim() || "root",
      password: env.MYSQL_PASSWORD ?? "",
      database: env.MYSQL_DATABASE?.trim() || "navos_new",
      connectionLimit: parsePositiveInt(env.MYSQL_CONNECTION_LIMIT, 100),
      queueLimit: parseNonNegativeInt(env.MYSQL_QUEUE_LIMIT, 0)
    },
    defaultAccount,
    vipBaseUrl: (env.VIP_BASE_URL?.trim() || "https://navos-mind-server-vip.tec-do.com").replace(/\/+$/, ""),
    vipHmacSecret: requireEnv(env, "VIP_HMAC_SECRET"),
    poolTargetSize: parseNonNegativeInt(env.POOL_TARGET_SIZE, 0),
    registrationConcurrency: parseCappedPositiveInt(
      env.REGISTRATION_CONCURRENCY,
      DEFAULT_REGISTRATION_CONCURRENCY,
      REGISTRATION_CONCURRENCY_CAP
    ),
    registrationMaxInFlight: parseCappedPositiveInt(env.REGISTRATION_MAX_IN_FLIGHT, 10000, REGISTRATION_MAX_IN_FLIGHT_CAP),
    registrationMailboxCreateConcurrency: parseCappedPositiveInt(
      env.REGISTRATION_MAILBOX_CREATE_CONCURRENCY,
      20,
      REGISTRATION_MAILBOX_CREATE_CONCURRENCY_CAP
    ),
    registrationMailboxCreatePerSecond: parseCappedPositiveInt(
      env.REGISTRATION_MAILBOX_CREATE_PER_SECOND,
      50,
      REGISTRATION_MAILBOX_CREATE_PER_SECOND_CAP
    ),
    registrationVipSendConcurrency: parseCappedPositiveInt(
      env.REGISTRATION_VIP_SEND_CONCURRENCY,
      100,
      REGISTRATION_VIP_SEND_CONCURRENCY_CAP
    ),
    registrationPollConcurrency: parseCappedPositiveInt(env.REGISTRATION_POLL_CONCURRENCY, 500, REGISTRATION_POLL_CONCURRENCY_CAP),
    registrationLoginConcurrency: parseCappedPositiveInt(env.REGISTRATION_LOGIN_CONCURRENCY, 100, REGISTRATION_LOGIN_CONCURRENCY_CAP),
    registrationCertConcurrency: parseCappedPositiveInt(env.REGISTRATION_CERT_CONCURRENCY, 100, REGISTRATION_CERT_CONCURRENCY_CAP),
    registrationVerificationTimeoutMs: parsePositiveInt(env.REGISTRATION_VERIFICATION_TIMEOUT_MS, 90_000),
    registrationYydsQuotaBlockSeconds: parsePositiveInt(env.REGISTRATION_YYDS_QUOTA_BLOCK_SECONDS, 300),
    redisUrl: env.REDIS_URL?.trim() || "redis://127.0.0.1:6379",
    queuePrefix: env.QUEUE_PREFIX?.trim() || "navos",
    registrationJobConcurrency: parseCappedPositiveInt(
      env.REGISTRATION_JOB_CONCURRENCY,
      DEFAULT_REGISTRATION_JOB_CONCURRENCY,
      REGISTRATION_CONCURRENCY_CAP
    ),
    registrationJobRemoveOnComplete: parsePositiveInt(env.REGISTRATION_JOB_REMOVE_ON_COMPLETE, 50),
    registrationJobRemoveOnFail: parsePositiveInt(env.REGISTRATION_JOB_REMOVE_ON_FAIL, 100),
    imageAccountWaitMs: parsePositiveInt(env.IMAGE_ACCOUNT_WAIT_MS, 120_000),
    imageMaxPollAttempts: parsePositiveInt(env.IMAGE_MAX_POLL_ATTEMPTS, 75),
    imagePollIntervalMs: parsePositiveInt(env.IMAGE_POLL_INTERVAL_MS, 4_000),
    imageAllowVideoReserveFallback: parseStrictBool(
      env.IMAGE_ALLOW_VIDEO_RESERVE_FALLBACK,
      false,
      "IMAGE_ALLOW_VIDEO_RESERVE_FALLBACK"
    ),
    accountBalanceReconcileEnabled: parseStrictBool(env.ACCOUNT_BALANCE_RECONCILE_ENABLED, true, "ACCOUNT_BALANCE_RECONCILE_ENABLED"),
    accountBalanceReconcileIntervalMinutes: parsePositiveInt(env.ACCOUNT_BALANCE_RECONCILE_INTERVAL_MINUTES, 30),
    accountBalanceReconcileBatchSize: parsePositiveInt(env.ACCOUNT_BALANCE_RECONCILE_BATCH_SIZE, 1000),
    accountBalanceReconcileConcurrency: parseCappedPositiveInt(
      env.ACCOUNT_BALANCE_RECONCILE_CONCURRENCY,
      50,
      ACCOUNT_BALANCE_RECONCILE_CONCURRENCY_CAP
    ),
    accountBalanceReconcileScope: parseAccountBalanceReconcileScope(env.ACCOUNT_BALANCE_RECONCILE_SCOPE),
    yydsDomainPool: normalizeYydsDomainPoolConfig({
      enabled: parseStrictBool(env.YYDS_DOMAIN_POOL_ENABLED, true, "YYDS_DOMAIN_POOL_ENABLED"),
      mode: parseDomainPoolMode(env.YYDS_DOMAIN_POOL_MODE),
      whitelist: parseCsv(env.YYDS_DOMAIN_WHITELIST).map((item) => item.toLowerCase()),
      blacklist: parseCsv(env.YYDS_DOMAIN_BLACKLIST).map((item) => item.toLowerCase()),
      refreshIntervalMinutes: parseYydsDomainRefreshIntervalMinutes(env.YYDS_DOMAIN_REFRESH_MINUTES)
    })
  };
}

