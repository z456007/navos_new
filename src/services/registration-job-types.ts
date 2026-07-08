export type RegistrationJobMode = "single" | "fill";
export type RegistrationJobState = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type RegistrationJobCreateInput =
  | { mode: "single" }
  | { mode: "fill"; target?: number; concurrency?: number };

export type RegistrationJobPayload =
  | { mode: "single"; cancelRequested?: boolean }
  | { mode: "fill"; target: number; concurrency: number; cancelRequested?: boolean };

export interface RegistrationJobProgress {
  started: number;
  completed: number;
  failed: number;
  total: number;
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
