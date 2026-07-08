import type { ProviderResult } from "./http.js";
import { ProviderHttpClient } from "./http.js";

export type NormalizedVideoStatus = "queued" | "running" | "succeeded" | "failed" | "unknown";

export interface NormalizedVideoTask {
  id?: string;
  status: NormalizedVideoStatus;
  videoUrl?: string;
  error?: string;
  raw: unknown;
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
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
  if (["running", "processing", "generating", "in_progress"].includes(normalized)) {
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
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    id: readString(record, ["id", "task_id", "taskId"]),
    status: mapStatus(readString(record, ["status", "state"])),
    videoUrl: readString(record, ["videoUrl", "video_url", "url", "output_url"]),
    error: readString(record, ["error", "error_message", "message"]),
    raw
  };
}

export async function createVideoTask<T = unknown>(
  client: ProviderHttpClient,
  payload: Record<string, unknown>,
  headers: Record<string, string>
): Promise<ProviderResult<T>> {
  return client.requestJson<T>("POST", "/api/video/generations", payload, headers);
}

export async function getVideoTask(
  client: ProviderHttpClient,
  taskId: string,
  headers: Record<string, string>
): Promise<ProviderResult<NormalizedVideoTask>> {
  const result = await client.requestJson("GET", `/api/video/generations/${encodeURIComponent(taskId)}`, undefined, headers);
  return {
    ...result,
    body: normalizeVideoTaskStatus(result.body)
  };
}

