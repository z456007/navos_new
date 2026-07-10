export type RegistrationJobMode = "single" | "fill" | "create";
export type RegistrationJobState = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type RegistrationJobCreateInput =
  | { mode: "single" }
  | { mode: "fill"; target?: number; concurrency?: number }
  | { mode: "create"; count: number; concurrency?: number };

export type RegistrationJobPayload =
  | { mode: "single"; cancelRequested?: boolean }
  | { mode: "fill"; target: number; concurrency: number; cancelRequested?: boolean }
  | { mode: "create"; count: number; concurrency: number; cancelRequested?: boolean };

export interface RegistrationJobProgress {
  started: number;
  completed: number;
  failed: number;
  total: number;
  skipped?: number;
}

export interface RegistrationJobLog {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
}

export interface RegistrationJobSnapshot {
  id: string;
  mode: RegistrationJobMode;
  state: RegistrationJobState;
  target?: number;
  count?: number;
  concurrency?: number;
  progress: RegistrationJobProgress;
  logs: RegistrationJobLog[];
  results?: unknown;
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface RegistrationJobCreateResponse {
  jobId: string;
}
