import type { ProviderResult } from "./http.js";
import { ProviderHttpClient } from "./http.js";
import { uploadAssetToUrl } from "./upload.js";

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
  sizeBytes?: number;
  sha256?: string;
  error?: string;
  raw: unknown;
}

interface MediaReference {
  source: string;
  role: string;
}

const SEEDANCE_2_MODEL = "navos/doubao-seedance-2-0-260128";
const SEEDANCE_2_ALIASES = new Set([
  "seedance-2.0",
  "seedance-2.0-pro",
  "doubao-seedance-2-0",
  "doubao-seedance-2-0-260128",
  SEEDANCE_2_MODEL
]);

export function isSeedanceVideoModel(model: unknown): boolean {
  if (model === undefined || model === null) {
    return true;
  }
  if (typeof model !== "string") {
    return false;
  }
  const normalized = model.trim().toLowerCase();
  return normalized === "" || SEEDANCE_2_ALIASES.has(normalized);
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

export function normalizeSeedanceVideoPayload(body: Record<string, unknown>): Record<string, unknown> {
  const sourceMetadata = isRecord(body.metadata) ? { ...body.metadata } : {};
  const prompt = readStringValue(body.prompt) ?? "";
  const duration = normalizeDurationForPayload(
    firstDefined(body.durationSeconds, body.duration_seconds, body.duration, body.seconds, body.dur, 5)
  );
  const aspectRatio = String(firstDefined(
    body.aspectRatio,
    body.aspect_ratio,
    body.ratio,
    sourceMetadata.ratio,
    "16:9"
  )).replace("x", ":");
  const resolution = String(firstDefined(body.resolution, sourceMetadata.resolution, "720P")).toUpperCase();
  const images = collectImageReferences(body, sourceMetadata);
  const videos = collectMediaReferences(
    [
      body.videos,
      body.video_urls,
      body.video_url,
      body.reference_videos,
      sourceMetadata.reference_videos
    ],
    body.videoRoles,
    body.video_roles,
    "reference_video",
    3
  );
  const audioRefs = collectMediaReferences(
    [
      body.audioRef,
      body.audio_url,
      body.audio_urls,
      body.audio_refs,
      body.audioRefs,
      body.reference_audios,
      sourceMetadata.reference_audios
    ],
    body.audioRoles,
    body.audio_roles,
    "reference_audio",
    3
  );

  const explicitAudio = firstDefined(
    body.audio,
    body.generate_audio,
    body.generateAudio,
    sourceMetadata.generate_audio
  );
  const audioEnabled = audioRefs.length > 0 || (explicitAudio === undefined ? false : Boolean(explicitAudio));
  const metadata: Record<string, unknown> = {
    ...sourceMetadata,
    ratio: aspectRatio,
    resolution,
    watermark: Boolean(firstDefined(body.watermark, sourceMetadata.watermark, false)),
    generate_audio: audioEnabled
  };

  const referenceImages = dedupeStrings(
    images
      .filter((image) => !isFrameRole(image.role))
      .map((image) => image.source)
  );
  if (referenceImages.length > 0) {
    metadata.reference_images = referenceImages;
  }
  if (videos.length > 0) {
    metadata.reference_videos = videos.map((video) => video.source);
  }
  if (audioRefs.length > 0) {
    metadata.reference_audios = audioRefs.map((audio) => audio.source);
  }
  for (const key of ["negative_prompt", "style", "quality_level"]) {
    const value = firstDefined(body[key], sourceMetadata[key]);
    if (value) {
      metadata[key] = value;
    }
  }

  const model = normalizeVideoModel(readStringValue(body.model) ?? SEEDANCE_2_MODEL);
  const payload: Record<string, unknown> = {
    model,
    label: String(firstDefined(body.label, prompt, "OpenClaw video generation")).slice(0, 120),
    prompt,
    duration,
    durationSeconds: duration,
    aspectRatio,
    resolution,
    audio: audioEnabled,
    watermark: Boolean(firstDefined(body.watermark, false)),
    timeoutMs: firstDefined(body.timeoutMs, body.timeout_ms),
    response_format: firstDefined(body.response_format, "url"),
    metadata
  };

  copyIfPresent(payload, body, "mode");
  copyIfPresent(payload, body, "generation_mode");
  if (images.length > 0) {
    const firstFrame = images.find((image) => isFirstFrameRole(image.role));
    if (firstFrame) {
      payload.image = firstFrame.source;
      payload.imageRoles = [firstFrame.role || "first_frame"];
    }
    const lastFrame = images.find((image) => isLastFrameRole(image.role));
    if (lastFrame) {
      payload.last_frame_image = lastFrame.source;
      payload.image_tail_url = lastFrame.source;
    }
  }
  if (videos.length > 0) {
    payload.videos = videos.map((video) => video.source);
    payload.videoRoles = videos.map((video) => video.role || "reference_video");
  }
  if (audioRefs.length > 0) {
    payload.audioRef = audioRefs[0]?.source;
    if (audioRefs.length > 1) {
      payload.audioRefs = audioRefs.slice(1).map((audio) => audio.source);
    }
    payload.audioRoles = audioRefs.map((audio) => audio.role || "reference_audio");
  }
  if (body.size) {
    payload.size = body.size;
  } else {
    Object.assign(payload, seedanceDimensions(aspectRatio, resolution));
  }
  copyIfPresent(payload, body, "fps");

  const providerOptions = isRecord(body.providerOptions) ? { ...body.providerOptions } : {};
  const seed = firstDefined(body.seed, providerOptions.seed);
  if (seed !== undefined) {
    payload.providerOptions = { ...providerOptions, seed };
  } else if (Object.keys(providerOptions).length > 0) {
    payload.providerOptions = providerOptions;
  }
  copyIfPresent(payload, body, "n");

  return omitNil(payload);
}

export async function prepareVideoTaskPayload(
  client: ProviderHttpClient,
  body: Record<string, unknown>,
  headers: Record<string, string>
): Promise<Record<string, unknown>> {
  const payload = normalizeSeedanceVideoPayload(body);
  return uploadVideoPayloadLocalAssets(client, payload, headers);
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

async function uploadVideoPayloadLocalAssets(
  client: ProviderHttpClient,
  payload: Record<string, unknown>,
  headers: Record<string, string>
): Promise<Record<string, unknown>> {
  const result = structuredCloneJson(payload);
  const cache = new Map<string, string>();

  const uploadOne = async (value: unknown, fallbackMime: string): Promise<unknown> => {
    if (typeof value !== "string" || value.length === 0 || !shouldUploadMediaSource(value)) {
      return value;
    }
    const cached = cache.get(value);
    if (cached) {
      return cached;
    }
    const url = await uploadAssetToUrl(client, {
      source: value,
      filename: defaultReferenceFilename(cache.size + 1, fallbackMime),
      headers
    });
    cache.set(value, url);
    return url;
  };

  const uploadList = async (key: string, fallbackMime: string) => {
    const values = result[key];
    if (Array.isArray(values)) {
      result[key] = await Promise.all(values.map((value) => uploadOne(value, fallbackMime)));
    } else {
      result[key] = await uploadOne(values, fallbackMime);
    }
  };

  await uploadList("image", "image/png");
  await uploadList("last_frame_image", "image/png");
  await uploadList("image_tail_url", "image/png");
  await uploadList("videos", "video/mp4");
  await uploadList("audioRef", "audio/mpeg");
  await uploadList("audioRefs", "audio/mpeg");

  const metadata = result.metadata;
  if (isRecord(metadata)) {
    for (const [key, fallbackMime] of [
      ["reference_images", "image/png"],
      ["reference_videos", "video/mp4"],
      ["reference_audios", "audio/mpeg"]
    ] as const) {
      const values = metadata[key];
      if (Array.isArray(values)) {
        metadata[key] = await Promise.all(values.map((value) => uploadOne(value, fallbackMime)));
      } else {
        metadata[key] = await uploadOne(values, fallbackMime);
      }
    }
  }

  return result;
}

function collectImageReferences(
  body: Record<string, unknown>,
  sourceMetadata: Record<string, unknown>
): MediaReference[] {
  const images: MediaReference[] = [];
  const addImage = (value: unknown, fallbackRole = "") => {
    const media = mediaReferenceFrom(value, fallbackRole);
    if (media && images.length < 9 && !images.some((image) => image.source === media.source)) {
      images.push(media);
    }
  };

  const explicitImages = asList(body.images);
  const explicitRoles = asStringList(firstDefined(body.imageRoles, body.image_roles));
  if (explicitImages.length > 0) {
    for (const [index, image] of explicitImages.slice(0, 9).entries()) {
      addImage(image, explicitRoles[index] ?? "");
    }
    return images;
  }

  const firstFrame = firstDefined(body.first_frame_image, body.first_frame_url);
  const primaryReference = firstDefined(body.image, body.input_image, body.image_url);
  const lastFrame = firstDefined(
    body.last_frame_image,
    body.image_tail,
    body.image_tail_url,
    body.end_image_url,
    body.end_frame_url
  );
  if (firstFrame) {
    addImage(firstFrame, "first_frame");
  } else if (primaryReference) {
    addImage(primaryReference, "reference_image");
  }
  for (const item of asList(body.image_with_roles)) {
    addImage(item);
  }
  for (const image of [
    ...asList(body.image_urls),
    ...asList(body.reference_images),
    ...asList(sourceMetadata.reference_images)
  ]) {
    addImage(image, "reference_image");
  }
  if (lastFrame) {
    addImage(lastFrame, "last_frame");
  }
  return images;
}

function collectMediaReferences(
  groups: unknown[],
  camelRoles: unknown,
  snakeRoles: unknown,
  defaultRole: string,
  max: number
): MediaReference[] {
  const roles = asStringList(firstDefined(camelRoles, snakeRoles));
  const refs: MediaReference[] = [];
  for (const item of groups.flatMap((group) => asList(group))) {
    const media = mediaReferenceFrom(item, roles[refs.length] ?? defaultRole);
    if (media && !refs.some((existing) => existing.source === media.source)) {
      refs.push({ ...media, role: media.role || defaultRole });
    }
    if (refs.length >= max) {
      break;
    }
  }
  return refs;
}

function mediaReferenceFrom(value: unknown, fallbackRole = ""): MediaReference | undefined {
  if (typeof value === "string") {
    const source = value.trim();
    return source ? { source, role: fallbackRole } : undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const source = readStringValue(
    firstDefined(value.url, value.source, value.src, value.image_url, value.image, value.video_url, value.audio_url)
  )?.trim();
  if (!source) {
    return undefined;
  }
  const role = readStringValue(firstDefined(value.role, value.imageRole, value.videoRole, value.audioRole)) ?? fallbackRole;
  return { source, role };
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function readStringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
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

function asStringList(value: unknown): string[] {
  return asList(value)
    .map((item) => readStringValue(item)?.trim())
    .filter((item): item is string => Boolean(item));
}

function dedupeStrings(values: string[]): string[] {
  return values.filter((value, index) => value.length > 0 && values.indexOf(value) === index);
}

function normalizeDurationForPayload(value: unknown): unknown {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value;
  }
  return value;
}

function normalizeVideoModel(model: string): string {
  const normalized = model.trim().toLowerCase();
  if (!normalized) {
    return SEEDANCE_2_MODEL;
  }
  return SEEDANCE_2_ALIASES.has(normalized) ? SEEDANCE_2_MODEL : model;
}

function isFrameRole(role: string): boolean {
  return ["first_frame", "first_frame_image", "last_frame", "last_frame_image"].includes(role);
}

function isFirstFrameRole(role: string): boolean {
  return ["first_frame", "first_frame_image"].includes(role);
}

function isLastFrameRole(role: string): boolean {
  return ["last_frame", "last_frame_image"].includes(role);
}

function seedanceDimensions(aspectRatio: string, resolution: string): Record<string, number> {
  const ratio = aspectRatio.replace("x", ":");
  const res = resolution === "480P" ? "480P" : "720P";
  const sizes: Record<string, Record<string, [number, number]>> = {
    "21:9": { "480P": [1120, 480], "720P": [1680, 720] },
    "16:9": { "480P": [854, 480], "720P": [1280, 720] },
    "4:3": { "480P": [640, 480], "720P": [960, 720] },
    "1:1": { "480P": [480, 480], "720P": [720, 720] },
    "3:4": { "480P": [480, 640], "720P": [720, 960] },
    "9:16": { "480P": [480, 854], "720P": [720, 1280] }
  };
  const size = sizes[ratio]?.[res];
  return size ? { width: size[0], height: size[1] } : {};
}

function copyIfPresent(target: Record<string, unknown>, source: Record<string, unknown>, key: string): void {
  const value = source[key];
  if (value !== undefined && value !== null && value !== "") {
    target[key] = value;
  }
}

function omitNil(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

function shouldUploadMediaSource(source: string): boolean {
  return source.startsWith("data:") || /^http:\/\//i.test(source);
}

function defaultReferenceFilename(index: number, fallbackMime: string): string {
  const extension = fallbackMime.includes("video")
    ? "mp4"
    : fallbackMime.includes("audio")
      ? "mp3"
      : "png";
  return `reference-${index}.${extension}`;
}

function structuredCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
