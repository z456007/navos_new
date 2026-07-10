import type { RegistrationJobState, RegistrationJobView } from "../types";

export function normalizeRegistrationJob(raw: unknown): RegistrationJobView {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const progress = record.progress && typeof record.progress === "object"
    ? record.progress as Record<string, unknown>
    : {};
  const modeValue = readString(record.mode);
  return {
    id: readString(record.id) ?? "",
    mode: modeValue === "single" || modeValue === "create" ? modeValue : "fill",
    state: mapRegistrationJobState(readString(record.state)),
    target: readNumber(record.target),
    count: readNumber(record.count),
    concurrency: readNumber(record.concurrency),
    progress: {
      started: readNumber(progress.started) ?? 0,
      completed: readNumber(progress.completed) ?? 0,
      failed: readNumber(progress.failed) ?? 0,
      total: readNumber(progress.total) ?? 0
    },
    logs: Array.isArray(record.logs)
      ? record.logs.map(normalizeLog).filter((item): item is RegistrationJobView["logs"][number] => Boolean(item))
      : [],
    results: record.results,
    error: readString(record.error),
    createdAt: readNumber(record.createdAt) ?? 0,
    startedAt: readNumber(record.startedAt),
    finishedAt: readNumber(record.finishedAt)
  };
}

export function registrationJobIsTerminal(job: RegistrationJobView): boolean {
  return job.state === "succeeded" || job.state === "failed" || job.state === "canceled";
}

function mapRegistrationJobState(value: string | undefined): RegistrationJobState {
  if (value === "completed" || value === "succeeded") return "succeeded";
  if (value === "active" || value === "running") return "running";
  if (value === "failed") return "failed";
  if (value === "canceled") return "canceled";
  return "queued";
}

function normalizeLog(value: unknown): RegistrationJobView["logs"][number] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const level = record.level === "warn" || record.level === "error" ? record.level : "info";
  return {
    at: readNumber(record.at) ?? 0,
    level,
    message: readString(record.message) ?? ""
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
