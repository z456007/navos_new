import { ProviderHttpClient, type ProviderResult } from "./http.js";

export interface ImageGenerationResult {
  url: string;
}

const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_IMAGE_SIZE = "1024x1024";
const DEFAULT_IMAGE_QUALITY = "auto";
const MAX_IMAGE_COUNT = 4;
const IMAGE_SIZE_PATTERN = /^(auto|\d{2,5}x\d{2,5})$/i;
const IMAGE_QUALITIES = new Set(["auto", "low", "medium", "high"]);

export function buildImageGenerationPayload(body: Record<string, unknown>): Record<string, unknown> {
  const prompt = readString(body.prompt)?.trim();
  if (!prompt) {
    throw new Error("prompt is required");
  }

  const quality = normalizeQuality(readString(body.quality) ?? DEFAULT_IMAGE_QUALITY);
  const size = normalizeSize(readString(body.size) ?? DEFAULT_IMAGE_SIZE);
  const n = normalizeCount(body.n ?? body.count ?? 1);

  return {
    model: readString(body.model)?.trim() || DEFAULT_IMAGE_MODEL,
    prompt,
    n,
    quality,
    size,
    response_format: "b64_json",
    output_format: "png"
  };
}

export async function createImageGeneration<T = unknown>(
  client: ProviderHttpClient,
  payload: Record<string, unknown>,
  headers: Record<string, string>
): Promise<ProviderResult<T>> {
  const created = await client.requestJson("POST", "/api/tasks/navos-gpt-image-t2i", stripModel(payload), headers);
  if (created.status < 200 || created.status >= 300) {
    return created as ProviderResult<T>;
  }
  const createdRecord = created.body as Record<string, unknown>;
  if (readCode(createdRecord) !== 200) {
    return {
      ...created,
      status: 502,
      body: { error: { message: readMessage(createdRecord) ?? "Image task creation failed", type: "server_error" } }
    } as ProviderResult<T>;
  }

  const taskId = readTaskId(created.body);
  if (!taskId) {
    return {
      ...created,
      status: 502,
      body: { error: { message: "No image task id returned", type: "server_error" } }
    } as ProviderResult<T>;
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (attempt > 0) {
      await delay(4000);
    }
    const polled = await client.requestJson(
      "GET",
      `/api/tasks/image/generations/${encodeURIComponent(taskId)}`,
      undefined,
      headers
    );
    if (polled.status < 200 || polled.status >= 300) {
      return polled as ProviderResult<T>;
    }
    const status = readTaskStatus(polled.body);
    if (status === "succeeded" || status === "success" || status === "completed") {
      const results = imageResponseToResults(polled.body);
      if (results.length === 0) {
        return {
          ...polled,
          status: 502,
          body: { error: { message: "Image task succeeded but no image URL returned", type: "server_error" } }
        } as ProviderResult<T>;
      }
      return {
        ...polled,
        status: 200,
        body: {
          created: Math.floor(Date.now() / 1000),
          status: "succeeded",
          task_id: taskId,
          id: taskId,
          data: results
        }
      } as ProviderResult<T>;
    }
    if (status === "failed" || status === "error" || status === "cancelled" || status === "canceled") {
      return {
        ...polled,
        status: 500,
        body: { error: { message: readMessage(polled.body) ?? "Image task failed", type: "server_error" }, task_id: taskId, id: taskId }
      } as ProviderResult<T>;
    }
  }

  return {
    ...created,
    status: 202,
    body: {
      created: Math.floor(Date.now() / 1000),
      status: "running",
      task_id: taskId,
      id: taskId,
      data: []
    }
  } as ProviderResult<T>;
}

export function imageResponseToResults(response: unknown): ImageGenerationResult[] {
  return collectImageItems(response)
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      if (typeof record.b64_json === "string" && record.b64_json) {
        return { url: `data:image/png;base64,${record.b64_json}` };
      }
      if (typeof record.url === "string" && record.url) {
        return { url: record.url };
      }
      return undefined;
    })
    .filter((item): item is ImageGenerationResult => item !== undefined);
}

function collectImageItems(value: unknown): unknown[] {
  const items: unknown[] = [];
  function visit(current: unknown): void {
    if (!current || typeof current !== "object") {
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) {
        visit(item);
      }
      return;
    }
    const record = current as Record<string, unknown>;
    if (typeof record.b64_json === "string" || typeof record.url === "string") {
      items.push(record);
    }
    for (const key of ["data", "result", "images", "output"]) {
      visit(record[key]);
    }
  }
  visit(value);
  return items;
}

function stripModel(payload: Record<string, unknown>): Record<string, unknown> {
  const { model: _model, ...rest } = payload;
  return rest;
}

function readTaskId(value: unknown): string | undefined {
  return readDeepString(value, ["task_id", "taskId", "id"]);
}

function readTaskStatus(value: unknown): string | undefined {
  return readDeepString(value, ["status", "state"])?.toLowerCase();
}

function readMessage(value: unknown): string | undefined {
  return readDeepString(value, ["message", "msg", "error_message"]);
}

function readCode(value: Record<string, unknown>): number | undefined {
  return typeof value.code === "number" ? value.code : undefined;
}

function readDeepString(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key]) {
      return record[key];
    }
  }
  for (const key of ["data", "result", "error"]) {
    const nested = readDeepString(record[key], keys);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCount(value: unknown): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return 1;
  }
  return Math.max(1, Math.min(MAX_IMAGE_COUNT, Math.floor(Math.abs(numberValue))));
}

function normalizeQuality(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!IMAGE_QUALITIES.has(normalized)) {
    throw new Error("quality must be one of auto, low, medium, high");
  }
  return normalized;
}

function normalizeSize(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!IMAGE_SIZE_PATTERN.test(normalized)) {
    throw new Error("size must be auto or WIDTHxHEIGHT");
  }
  return normalized;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
