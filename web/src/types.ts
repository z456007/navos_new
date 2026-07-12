export type AccountStatus = "active" | "disabled" | "depleted";

export interface AccountListItem {
  uid: string;
  tokenPreview: string;
  mailboxAddr?: string;
  balanceRemaining: number;
  balanceTotal: number;
  status: AccountStatus;
  createdAt: number;
  lastUsedAt: number;
  lastBalanceAt: number;
  rateLimitedUntil: number;
}

export interface Mailbox {
  address?: string;
  id?: string;
  token?: string;
}

export type RegistrationJobState = "queued" | "running" | "succeeded" | "failed" | "canceled";
export type RegistrationJobMode = "single" | "fill" | "create";

export interface RegistrationJobLog {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
}

export interface RegistrationJobView {
  id: string;
  mode: RegistrationJobMode;
  state: RegistrationJobState;
  target?: number;
  count?: number;
  concurrency?: number;
  progress: {
    started: number;
    completed: number;
    failed: number;
    total: number;
  };
  logs: RegistrationJobLog[];
  results?: unknown;
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export type PanelId = "accounts" | "chat" | "image" | "probe" | "video" | "yydsConfig" | "runtimeConfig";

export interface YydsMailConfig {
  id?: number;
  configured?: boolean;
  enabled?: boolean;
  apiKeyConfigured?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export type AccountBalanceReconcileScope = "depleted" | "active" | "non_disabled" | "all";

export type BalanceReconcileScope = AccountBalanceReconcileScope;

export interface BalanceReconcileResult {
  checked: number;
  restored: number;
  stillDepleted: number;
  updatedActive: number;
  disabledUpdated: number;
  failed: number;
  failures: Array<{ uid: string; message: string }>;
}

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
  restartRequiredKeys?: string[];
  updatedAt?: number;
}

export type VideoTaskStatus = "queued" | "running" | "succeeded" | "failed" | "unknown";

export interface VideoTaskView {
  id?: string;
  status: VideoTaskStatus;
  videoUrl?: string;
  sizeBytes?: number;
  sha256?: string;
  error?: string;
  raw: unknown;
}

export type StatusKind = "idle" | "loading" | "ok" | "error";

export interface StatusState {
  kind: StatusKind;
  message: string;
}
