import type { AppConfig } from "../config/env.js";

export type AccountBalanceReconcileScope = "depleted" | "active" | "non_disabled" | "all";

export interface RuntimeConfigView {
  imageAllowVideoReserveFallback: boolean;
  imageAccountWaitMs: number;
  imageMaxPollAttempts: number;
  imagePollIntervalMs: number;
  imageSyncWaitBudgetMs: number;
  videoCreateTimeoutMs: number;
  videoPollTimeoutMs: number;
  modelAccountWaitMs: number;
  accountLeaseTtlMs: number;
  accountBalanceReconcileEnabled: boolean;
  accountBalanceReconcileIntervalMinutes: number;
  accountBalanceReconcileBatchSize: number;
  accountBalanceReconcileConcurrency: number;
  accountBalanceReconcileScope: AccountBalanceReconcileScope;
  registrationConcurrency: number;
  registrationMaxInFlight: number;
  registrationMailboxCreateConcurrency: number;
  registrationMailboxCreatePerSecond: number;
  registrationVipSendConcurrency: number;
  registrationPollConcurrency: number;
  registrationLoginConcurrency: number;
  registrationCertConcurrency: number;
  registrationYydsQuotaBlockSeconds: number;
  mysqlConnectionLimit: number;
  mysqlQueueLimit: number;
  restartRequiredKeys: string[];
  updatedAt: number;
}

export type RuntimeConfigUpdateInput = Partial<Record<keyof RuntimeConfigView, unknown>>;

export const RUNTIME_CONFIG_RESTART_REQUIRED_KEYS = [
  "mysqlConnectionLimit",
  "mysqlQueueLimit"
] as const;

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfigView = {
  imageAllowVideoReserveFallback: false,
  imageAccountWaitMs: 120000,
  imageMaxPollAttempts: 75,
  imagePollIntervalMs: 4000,
  imageSyncWaitBudgetMs: 300000,
  videoCreateTimeoutMs: 30000,
  videoPollTimeoutMs: 30000,
  modelAccountWaitMs: 30000,
  accountLeaseTtlMs: 600000,
  accountBalanceReconcileEnabled: true,
  accountBalanceReconcileIntervalMinutes: 30,
  accountBalanceReconcileBatchSize: 1000,
  accountBalanceReconcileConcurrency: 50,
  accountBalanceReconcileScope: "depleted",
  registrationConcurrency: 20,
  registrationMaxInFlight: 10000,
  registrationMailboxCreateConcurrency: 20,
  registrationMailboxCreatePerSecond: 50,
  registrationVipSendConcurrency: 100,
  registrationPollConcurrency: 500,
  registrationLoginConcurrency: 100,
  registrationCertConcurrency: 100,
  registrationYydsQuotaBlockSeconds: 300,
  mysqlConnectionLimit: 100,
  mysqlQueueLimit: 0,
  restartRequiredKeys: [...RUNTIME_CONFIG_RESTART_REQUIRED_KEYS],
  updatedAt: 0
};

export function runtimeConfigDefaultsFromAppConfig(config: AppConfig): RuntimeConfigView {
  return normalizeRuntimeConfigInput({
    ...DEFAULT_RUNTIME_CONFIG,
    imageAllowVideoReserveFallback: config.imageAllowVideoReserveFallback,
    imageAccountWaitMs: config.imageAccountWaitMs,
    imageMaxPollAttempts: config.imageMaxPollAttempts,
    imagePollIntervalMs: config.imagePollIntervalMs,
    accountBalanceReconcileEnabled: config.accountBalanceReconcileEnabled,
    accountBalanceReconcileIntervalMinutes: config.accountBalanceReconcileIntervalMinutes,
    accountBalanceReconcileBatchSize: config.accountBalanceReconcileBatchSize,
    accountBalanceReconcileConcurrency: config.accountBalanceReconcileConcurrency,
    accountBalanceReconcileScope: config.accountBalanceReconcileScope,
    registrationConcurrency: config.registrationConcurrency,
    registrationMaxInFlight: config.registrationMaxInFlight,
    registrationMailboxCreateConcurrency: config.registrationMailboxCreateConcurrency,
    registrationMailboxCreatePerSecond: config.registrationMailboxCreatePerSecond,
    registrationVipSendConcurrency: config.registrationVipSendConcurrency,
    registrationPollConcurrency: config.registrationPollConcurrency,
    registrationLoginConcurrency: config.registrationLoginConcurrency,
    registrationCertConcurrency: config.registrationCertConcurrency,
    registrationYydsQuotaBlockSeconds: config.registrationYydsQuotaBlockSeconds,
    mysqlConnectionLimit: config.mysql.connectionLimit,
    mysqlQueueLimit: config.mysql.queueLimit,
    updatedAt: 0
  });
}

export function normalizeRuntimeConfigInput(
  input: RuntimeConfigUpdateInput,
  base: RuntimeConfigView = DEFAULT_RUNTIME_CONFIG
): RuntimeConfigView {
  const next: RuntimeConfigView = { ...base };
  next.imageAllowVideoReserveFallback = boolInput(input.imageAllowVideoReserveFallback, next.imageAllowVideoReserveFallback);
  next.imageAccountWaitMs = intInput(input.imageAccountWaitMs, next.imageAccountWaitMs, 0, 300000);
  next.imageMaxPollAttempts = intInput(input.imageMaxPollAttempts, next.imageMaxPollAttempts, 1, 120);
  next.imagePollIntervalMs = intInput(input.imagePollIntervalMs, next.imagePollIntervalMs, 1000, 60000);
  next.imageSyncWaitBudgetMs = intInput(input.imageSyncWaitBudgetMs, next.imageSyncWaitBudgetMs, 0, 300000);
  next.videoCreateTimeoutMs = intInput(input.videoCreateTimeoutMs, next.videoCreateTimeoutMs, 5000, 300000);
  next.videoPollTimeoutMs = intInput(input.videoPollTimeoutMs, next.videoPollTimeoutMs, 5000, 300000);
  next.modelAccountWaitMs = intInput(input.modelAccountWaitMs, next.modelAccountWaitMs, 0, 120000);
  next.accountLeaseTtlMs = intInput(input.accountLeaseTtlMs, next.accountLeaseTtlMs, 60000, 3600000);
  next.accountBalanceReconcileEnabled = boolInput(input.accountBalanceReconcileEnabled, next.accountBalanceReconcileEnabled);
  next.accountBalanceReconcileIntervalMinutes = intInput(input.accountBalanceReconcileIntervalMinutes, next.accountBalanceReconcileIntervalMinutes, 1, 1440);
  next.accountBalanceReconcileBatchSize = intInput(input.accountBalanceReconcileBatchSize, next.accountBalanceReconcileBatchSize, 1, 10000);
  next.accountBalanceReconcileConcurrency = intInput(input.accountBalanceReconcileConcurrency, next.accountBalanceReconcileConcurrency, 1, 500);
  next.accountBalanceReconcileScope = scopeInput(input.accountBalanceReconcileScope, next.accountBalanceReconcileScope);
  next.registrationConcurrency = intInput(input.registrationConcurrency, next.registrationConcurrency, 1, 5000);
  next.registrationMaxInFlight = intInput(input.registrationMaxInFlight, next.registrationMaxInFlight, 1, 100000);
  next.registrationMailboxCreateConcurrency = intInput(input.registrationMailboxCreateConcurrency, next.registrationMailboxCreateConcurrency, 1, 5000);
  next.registrationMailboxCreatePerSecond = intInput(input.registrationMailboxCreatePerSecond, next.registrationMailboxCreatePerSecond, 1, 5000);
  next.registrationVipSendConcurrency = intInput(input.registrationVipSendConcurrency, next.registrationVipSendConcurrency, 1, 5000);
  next.registrationPollConcurrency = intInput(input.registrationPollConcurrency, next.registrationPollConcurrency, 1, 5000);
  next.registrationLoginConcurrency = intInput(input.registrationLoginConcurrency, next.registrationLoginConcurrency, 1, 5000);
  next.registrationCertConcurrency = intInput(input.registrationCertConcurrency, next.registrationCertConcurrency, 1, 5000);
  next.registrationYydsQuotaBlockSeconds = intInput(input.registrationYydsQuotaBlockSeconds, next.registrationYydsQuotaBlockSeconds, 1, 86400);
  next.mysqlConnectionLimit = intInput(input.mysqlConnectionLimit, next.mysqlConnectionLimit, 1, 1000);
  next.mysqlQueueLimit = intInput(input.mysqlQueueLimit, next.mysqlQueueLimit, 0, 100000);
  next.restartRequiredKeys = [...RUNTIME_CONFIG_RESTART_REQUIRED_KEYS];
  next.updatedAt = Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : next.updatedAt;
  return next;
}

function intInput(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(numeric)));
}

function boolInput(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === true;
}

function scopeInput(value: unknown, fallback: AccountBalanceReconcileScope): AccountBalanceReconcileScope {
  return value === "active" || value === "non_disabled" || value === "all" || value === "depleted" ? value : fallback;
}
