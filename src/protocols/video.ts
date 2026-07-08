import type { ProviderResult } from "./http.js";
import { ProviderHttpClient } from "./http.js";

export type NormalizedVideoStatus = "queued" | "running" | "succeeded" | "failed" | "unknown";
export type VideoResolution = "480P" | "720P" | "1080P";

export const VIDEO_DURATION_LIMITS: Record<VideoResolution, number> = {
  "480P": 15,
  "720P": 10,
  "1080P": 5
};

export interface NormalizedVideoTask {
  id?: string;
  status: NormalizedVideoStatus;
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

export function assertVideoGenerationRules(payload: Record<string, unknown>): void {
  const resolution = normalizeResolution(payload.resolution);
  const duration = normalizeDuration(payload.durationSeconds ?? payload.duration_seconds ?? payload.duration);
  const limit = VIDEO_DURATION_LIMITS[resolution];
  if (duration !== undefined && duration > limit) {
    throw new Error(`${resolution} 最长只能生成 ${limit} 秒`);
  }
}

function normalizeResolution(value: unknown): VideoResolution {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "720P";
  if (normalized === "480P" || normalized === "720P" || normalized === "1080P") {
    return normalized;
  }
  throw new Error("resolution must be one of 480P, 720P, 1080P");
}

function normalizeDuration(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("durationSeconds must be a positive number");
  }
  return duration;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function candidateRecords(raw: unknown): Record<string, unknown>[] {
  if (!isRecord(raw)) {
    return [];
  }

  const records = [raw];
  const firstData = raw.data;
  if (isRecord(firstData)) {
    records.push(firstData);
    const nestedData = firstData.data;
    if (isRecord(nestedData)) {
      records.push(nestedData);
    }
  }

  return records;
}

function readString(records: Record<string, unknown>[], keys: string[]): string | undefined {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
  }
  return undefined;
}

function mapStatus(status: string | undefined): NormalizedVideoStatus {
  const normalized = status?.toLowerCase();
  if (!normalized) {
    return "unknown";
  }
  if (["queued", "pending", "created"].includes(normalized)) {
    return "queued";
  }
  if (["deducted", "running", "processing", "generating", "in_progress"].includes(normalized)) {
    return "running";
  }
  if (["success", "succeeded", "completed", "done"].includes(normalized)) {
    return "succeeded";
  }
  if (["fail", "failed", "error", "canceled", "cancelled"].includes(normalized)) {
    return "failed";
  }
  return "unknown";
}

export function normalizeVideoTaskStatus(raw: unknown): NormalizedVideoTask {
  const records = candidateRecords(raw);
  return {
    id: readString(records, ["id", "task_id", "taskId"]),
    status: mapStatus(readString(records, ["status", "state"])),
    videoUrl: readString(records, ["videoUrl", "video_url", "url", "output_url"]),
    error: readString(records, ["error", "error_message", "message"]),
    raw
  };
}

export async function createVideoTask<T = unknown>(
  client: ProviderHttpClient,
  payload: Record<string, unknown>,
  headers: Record<string, string>
): Promise<ProviderResult<T>> {
  return client.requestJson<T>("POST", "/api/tasks/navos-seedance-video-generation", payload, headers);
}

export async function getVideoTask(
  client: ProviderHttpClient,
  taskId: string,
  headers: Record<string, string>
): Promise<ProviderResult<NormalizedVideoTask>> {
  const result = await client.requestJson("GET", `/api/tasks/video/generations/${encodeURIComponent(taskId)}`, undefined, headers);
  return {
    ...result,
    body: normalizeVideoTaskStatus(result.body)
  };
}
