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
export type RegistrationJobMode = "single" | "fill";

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

export type PanelId = "accounts" | "chat" | "probe" | "video" | "cos" | "yydsConfig";

export interface CosConfig {
  id?: number;
  name?: string;
  configured?: boolean;
  enabled?: boolean;
  secretIdConfigured?: boolean;
  secretKeyConfigured?: boolean;
  bucket?: string;
  region?: string;
  appId?: string;
  publicDomain?: string;
  uploadPrefix?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface YydsMailConfig {
  id?: number;
  configured?: boolean;
  enabled?: boolean;
  apiKeyConfigured?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export type VideoTaskStatus = "queued" | "running" | "succeeded" | "failed" | "unknown";

export interface VideoTaskView {
  id?: string;
  status: VideoTaskStatus;
  videoUrl?: string;
  cosUrl?: string;
  cosKey?: string;
  archiveStatus?: string;
  archiveError?: string;
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
