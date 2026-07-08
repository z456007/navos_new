import type { VideoTaskStatus, VideoTaskView } from "../types";

export const videoDurationLimits: Record<string, number> = {
  "480P": 15,
  "720P": 10,
  "1080P": 5
};

export function readVideoString(value: unknown, keys: string[]): string | undefined {
  const queue: unknown[] = [value];
  while (queue.length > 0) {
    const current = queue.shift();
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    if (!isRecord(current)) {
      continue;
    }
    for (const key of keys) {
      const item = current[key];
      if ((typeof item === "string" || typeof item === "number") && String(item).length > 0) {
        return String(item);
      }
    }
    for (const item of Object.values(current)) {
      if (isRecord(item) || Array.isArray(item)) {
        queue.push(item);
      }
    }
  }
  return undefined;
}

export function videoDurationLimit(resolution: string): number {
  return videoDurationLimits[resolution] ?? videoDurationLimits["720P"];
}

export function mapVideoStatus(status: string | undefined): VideoTaskStatus {
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

export function normalizeVideoTask(raw: unknown, fallbackId?: string): VideoTaskView {
  const status = mapVideoStatus(readVideoString(raw, ["status", "state"]));
  return {
    id: readVideoString(raw, ["id", "task_id", "taskId"]) ?? fallbackId,
    status,
    videoUrl: readVideoString(raw, ["videoUrl", "video_url", "url", "output_url"]),
    cosUrl: readVideoString(raw, ["cosUrl", "cos_url"]),
    cosKey: readVideoString(raw, ["cosKey", "cos_key"]),
    archiveStatus: readVideoString(raw, ["archiveStatus", "archive_status"]),
    archiveError: readVideoString(raw, ["archiveError", "archive_error"]),
    sizeBytes: readVideoNumber(raw, ["sizeBytes", "size_bytes"]),
    sha256: readVideoString(raw, ["sha256"]),
    error: status === "failed" ? readVideoString(raw, ["error", "error_message", "message"]) : undefined,
    raw
  };
}

export function readVideoNumber(value: unknown, keys: string[]): number | undefined {
  const found = readVideoString(value, keys);
  if (!found) {
    return undefined;
  }
  const numeric = Number(found);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function archiveTone(status: string | undefined): "ok" | "wait" | "bad" | "muted" {
  if (status === "archived") {
    return "ok";
  }
  if (status === "failed") {
    return "bad";
  }
  if (status === "archiving" || status === "pending") {
    return "wait";
  }
  return "muted";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
