import { ProviderHttpClient, type ProviderResult } from "./http.js";

export interface ImageGenerationResult {
  url: string;
  sizeBytes?: number;
  sha256?: string;
}

const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_IMAGE_SIZE = "1024x1024";
const DEFAULT_IMAGE_QUALITY = "auto";
const MAX_IMAGE_COUNT = 4;
const MAX_REFERENCE_IMAGES = 8;
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
  const references = collectReferenceImages(body);

  return omitUndefined({
    model: readString(body.model)?.trim() || DEFAULT_IMAGE_MODEL,
    prompt,
    n,
    quality,
    size,
    response_format: "b64_json",
    output_format: "png",
    background: readString(body.background)?.trim() || undefined,
    images: references.length > 0 ? references : undefined
  });
}

export async function createImageGeneration<T = unknown>(
  client: ProviderHttpClient,
  payload: Record<string, unknown>,
  headers: Record<string, string>
): Promise<ProviderResult<T>> {
  const references = referenceImagesFromPayload(payload);
  if (references.length > 0) {
    return createImageEdit(client, payload, references, headers);
  }
  return createTextImageGeneration(client, payload, headers);
}

export function imageResponseToResults(response: unknown): ImageGenerationResult[] {
  return collectImageItems(response)
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      const result: ImageGenerationResult = { url: "" };
      if (typeof record.b64_json === "string" && record.b64_json) {
        result.url = `data:image/png;base64,${record.b64_json}`;
      } else if (typeof record.url === "string" && record.url) {
        result.url = record.url;
      } else {
        return undefined;
      }
      copyNumber(record, result, "sizeBytes", "sizeBytes");
      copyNumber(record, result, "size_bytes", "sizeBytes");
      copyString(record, result, "sha256", "sha256");
      return result;
    })
    .filter((item): item is ImageGenerationResult => item !== undefined);
}

async function createTextImageGeneration<T = unknown>(
  client: ProviderHttpClient,
  payload: Record<string, unknown>,
  headers: Record<string, string>
): Promise<ProviderResult<T>> {
  const created = await client.requestJson("POST", "/api/tasks/navos-gpt-image-t2i", stripModelAndReferences(payload), headers);
  return pollCreatedImageTask(client, created, headers, "/api/tasks/image/generations") as Promise<ProviderResult<T>>;
}

async function createImageEdit<T = unknown>(
  client: ProviderHttpClient,
  payload: Record<string, unknown>,
  references: string[],
  headers: Record<string, string>
): Promise<ProviderResult<T>> {
  const form = new FormData();
  form.set("prompt", String(payload.prompt ?? ""));
  form.set("model", String(payload.model ?? DEFAULT_IMAGE_MODEL));
  form.set("size", String(payload.size ?? DEFAULT_IMAGE_SIZE));
  form.set("quality", String(payload.quality ?? DEFAULT_IMAGE_QUALITY));
  form.set("response_format", String(payload.response_format ?? "url"));
  form.set("output_format", String(payload.output_format ?? "png"));
  form.set("n", String(payload.n ?? 1));
  if (typeof payload.background === "string" && payload.background) {
    form.set("background", payload.background);
  }

  for (const [index, reference] of references.slice(0, MAX_REFERENCE_IMAGES).entries()) {
    const file = await imageSourceToBlob(reference, index + 1);
    form.append("image", file.blob, file.filename);
  }

  const formHeaders = withoutContentType(headers);
  const created = await client.request("POST", "/api/tasks/navos-gpt-image-i2i", {
    body: form,
    headers: formHeaders
  });
  return pollCreatedImageTask(client, created, headers, "/api/tasks/image/edits") as Promise<ProviderResult<T>>;
}

async function pollCreatedImageTask(
  client: ProviderHttpClient,
  created: ProviderResult,
  headers: Record<string, string>,
  pollBasePath: string
): Promise<ProviderResult> {
  if (created.status < 200 || created.status >= 300) {
    return created;
  }
  const createdRecord = created.body as Record<string, unknown>;
  const code = readCode(createdRecord);
  if (code !== undefined && code !== 200) {
    return {
      ...created,
      status: 502,
      body: { error: { message: readMessage(createdRecord) ?? "Image task creation failed", type: "server_error" } }
    };
  }

  const taskId = readTaskId(created.body);
  if (!taskId) {
    return {
      ...created,
      status: 502,
      body: { error: { message: "No image task id returned", type: "server_error" } }
    };
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (attempt > 0) {
      await delay(4000);
    }
    const polled = await client.requestJson(
      "GET",
      `${pollBasePath}/${encodeURIComponent(taskId)}`,
      undefined,
      headers
    );
    if (polled.status < 200 || polled.status >= 300) {
      return polled;
    }
    const status = readTaskStatus(polled.body);
    if (status === "succeeded" || status === "success" || status === "completed") {
      const results = imageResponseToResults(polled.body);
      if (results.length === 0) {
        return {
          ...polled,
          status: 502,
          body: { error: { message: "Image task succeeded but no image URL returned", type: "server_error" } }
        };
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
      };
    }
    if (status === "failed" || status === "error" || status === "cancelled" || status === "canceled") {
      return {
        ...polled,
        status: 500,
        body: { error: { message: readMessage(polled.body) ?? "Image task failed", type: "server_error" }, task_id: taskId, id: taskId }
      };
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
  };
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

function collectReferenceImages(body: Record<string, unknown>): string[] {
  const references: string[] = [];
  for (const key of ["image", "input_image", "images", "reference_images", "input_images", "image_urls", "image_url"]) {
    for (const value of asList(body[key])) {
      const source = imageReferenceSource(value);
      if (source && !references.includes(source)) {
        references.push(source);
      }
      if (references.length >= MAX_REFERENCE_IMAGES) {
        return references;
      }
    }
  }
  return references;
}

function referenceImagesFromPayload(payload: Record<string, unknown>): string[] {
  return asList(payload.images)
    .map(imageReferenceSource)
    .filter((item): item is string => Boolean(item))
    .slice(0, MAX_REFERENCE_IMAGES);
}

function imageReferenceSource(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return readString(record.url)
    ?? readString(record.image_url)
    ?? readString(record.source)
    ?? readString(record.src)
    ?? readString(record.b64_json);
}

function stripModelAndReferences(payload: Record<string, unknown>): Record<string, unknown> {
  const { model: _model, images: _images, ...rest } = payload;
  return rest;
}

function readTaskId(value: unknown): string | undefined {
  return readDeepString(value, ["task_id", "taskId", "id"]);
}

function readTaskStatus(value: unknown): string | undefined {
  return readDeepString(value, ["status", "state"])?.toLowerCase();
}

function readMessage(value: unknown): string | undefined {
  const explicitError = readDeepString(value, ["error", "error_message"]);
  if (explicitError) {
    return explicitError;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const errorObjectMessage = readDeepString(record.error, ["message", "msg", "error_message"]);
    if (errorObjectMessage) {
      return errorObjectMessage;
    }
    const dataMessage = readDeepString(record.data, ["message", "msg"]);
    if (dataMessage) {
      return dataMessage;
    }
  }
  return readDeepString(value, ["message", "msg"]);
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

async function imageSourceToBlob(source: string, index: number): Promise<{ blob: Blob; filename: string }> {
  const data = source.startsWith("data:")
    ? imageDataUrlToBytes(source)
    : await remoteOrBase64ImageToBytes(source);
  const arrayBuffer = new ArrayBuffer(data.bytes.byteLength);
  new Uint8Array(arrayBuffer).set(data.bytes);
  return {
    blob: new Blob([arrayBuffer], { type: data.mimeType }),
    filename: `reference-${index}.${extensionFromMime(data.mimeType)}`
  };
}

function imageDataUrlToBytes(source: string): { bytes: Uint8Array; mimeType: string } {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(source);
  if (!match) {
    throw new Error("Invalid reference image data URL");
  }
  const mimeType = match[1] || "image/png";
  if (!mimeType.startsWith("image/")) {
    throw new Error(`Reference file is not an image: ${mimeType}`);
  }
  return { bytes: Buffer.from(match[2] ?? "", "base64"), mimeType };
}

async function remoteOrBase64ImageToBytes(source: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Reference image fetch failed: ${response.status}`);
    }
    const mimeType = response.headers.get("content-type")?.split(";", 1)[0] || "image/png";
    if (!mimeType.startsWith("image/")) {
      throw new Error(`Reference URL is not an image: ${mimeType}`);
    }
    return { bytes: new Uint8Array(await response.arrayBuffer()), mimeType };
  }
  return { bytes: Buffer.from(source.replace(/\s/g, ""), "base64"), mimeType: "image/png" };
}

function extensionFromMime(mimeType: string): string {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
    return "jpg";
  }
  if (mimeType.includes("webp")) {
    return "webp";
  }
  if (mimeType.includes("gif")) {
    return "gif";
  }
  return "png";
}

function withoutContentType(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([key]) => key.toLowerCase() !== "content-type"));
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

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return [value];
}

function omitUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function copyString(
  source: Record<string, unknown>,
  target: ImageGenerationResult,
  sourceKey: string,
  targetKey: keyof ImageGenerationResult
): void {
  const value = source[sourceKey];
  if (typeof value === "string" && value) {
    target[targetKey] = value as never;
  }
}

function copyNumber(
  source: Record<string, unknown>,
  target: ImageGenerationResult,
  sourceKey: string,
  targetKey: keyof ImageGenerationResult
): void {
  const value = source[sourceKey];
  if (typeof value === "number" && Number.isFinite(value)) {
    target[targetKey] = value as never;
  }
}
