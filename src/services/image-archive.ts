import { createHash, createHmac, randomBytes } from "node:crypto";
import type { FetchLike } from "../protocols/http.js";
import type { EnabledCosConfig } from "./cos-config-service.js";
import { buildCosPublicUrl } from "./video-archive.js";

export interface ArchiveImageInput {
  taskId: string;
  index: number;
  sourceUrl: string;
  config: EnabledCosConfig;
  fetchImpl?: FetchLike;
  now?: () => Date;
  randomHex?: (bytes: number) => string;
}

export interface ArchiveImageResult {
  cosUrl: string;
  cosKey: string;
  sizeBytes: number;
  sha256: string;
}

interface CosPutObjectInput {
  secretId: string;
  secretKey: string;
  bucket: string;
  region: string;
  key: string;
  body: Buffer;
  contentType: string;
  fetchImpl: FetchLike;
}

export async function archiveImageToCos(input: ArchiveImageInput): Promise<ArchiveImageResult> {
  const downloaded = input.sourceUrl.startsWith("data:")
    ? imageDataUrlToBuffer(input.sourceUrl)
    : await downloadImage(input.sourceUrl, input.fetchImpl ?? fetch);
  if (downloaded.buffer.length === 0) {
    throw new Error("downloaded image is empty");
  }

  const sha256 = createHash("sha256").update(downloaded.buffer).digest("hex");
  const key = buildImageCosKey({
    taskId: input.taskId,
    index: input.index,
    prefix: input.config.uploadPrefix,
    contentType: downloaded.contentType,
    now: input.now?.() ?? new Date(),
    randomHex: input.randomHex ?? ((bytes) => randomBytes(bytes).toString("hex"))
  });

  await putCosObject({
    secretId: input.config.secretId,
    secretKey: input.config.secretKey,
    bucket: input.config.bucket,
    region: input.config.region,
    key,
    body: downloaded.buffer,
    contentType: downloaded.contentType,
    fetchImpl: input.fetchImpl ?? fetch
  });

  return {
    cosUrl: buildCosPublicUrl(input.config, key),
    cosKey: key,
    sizeBytes: downloaded.buffer.length,
    sha256
  };
}

export function buildImageCosKey(input: {
  taskId: string;
  index: number;
  prefix: string;
  contentType: string;
  now: Date;
  randomHex: (bytes: number) => string;
}): string {
  const prefix = imagePrefix(input.prefix);
  const year = input.now.getFullYear();
  const month = String(input.now.getMonth() + 1).padStart(2, "0");
  const day = String(input.now.getDate()).padStart(2, "0");
  const ext = extensionFromContentType(input.contentType);
  return `${prefix}/${year}/${month}/${day}/${safePathPart(input.taskId)}_${input.index}_${input.randomHex(4)}.${ext}`;
}

function imagePrefix(value: string): string {
  const prefix = value.replace(/^\/+|\/+$/g, "") || "navos";
  if (prefix.endsWith("/images")) {
    return prefix;
  }
  if (prefix.endsWith("/videos")) {
    return `${prefix.slice(0, -"/videos".length)}/images`;
  }
  return `${prefix}/images`;
}

function imageDataUrlToBuffer(source: string): { buffer: Buffer; contentType: string } {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(source);
  if (!match) {
    throw new Error("Invalid image data URL");
  }
  const contentType = match[1] || "image/png";
  if (!contentType.startsWith("image/")) {
    throw new Error(`data URL is not image: ${contentType}`);
  }
  return { buffer: Buffer.from(match[2] ?? "", "base64"), contentType };
}

async function downloadImage(sourceUrl: string, fetchImpl: FetchLike): Promise<{ buffer: Buffer; contentType: string }> {
  const response = await fetchImpl(sourceUrl);
  if (!response.ok) {
    throw new Error(`download image failed: ${response.status}`);
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0] || "image/png";
  if (!contentType.startsWith("image/") && !/\.(png|jpe?g|webp|gif)(?:\?|#|$)/i.test(sourceUrl)) {
    throw new Error(`downloaded file is not image: ${contentType}`);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: contentType.startsWith("image/") ? contentType : "image/png"
  };
}

async function putCosObject(input: CosPutObjectInput): Promise<void> {
  const host = `${input.bucket}.cos.${input.region}.myqcloud.com`;
  const path = `/${input.key.split("/").map(encodeURIComponent).join("/")}`;
  const url = `https://${host}${path}`;
  const headers: Record<string, string> = {
    host,
    "x-cos-server-side-encryption": "AES256"
  };
  const authorization = cosAuthorization({
    method: "put",
    path,
    headers,
    secretId: input.secretId,
    secretKey: input.secretKey
  });
  const response = await input.fetchImpl(url, {
    method: "PUT",
    headers: {
      authorization,
      "content-type": input.contentType,
      "x-cos-server-side-encryption": "AES256"
    },
    body: input.body as unknown as BodyInit
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`COS upload failed: ${response.status} ${text.slice(0, 160)}`);
  }
}

function cosAuthorization(input: {
  method: string;
  path: string;
  headers: Record<string, string>;
  secretId: string;
  secretKey: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const expires = now + 600;
  const keyTime = `${now};${expires}`;
  const headerEntries = Object.entries(input.headers)
    .map(([key, value]) => [key.toLowerCase(), value.trim()] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  const headerList = headerEntries.map(([key]) => key).join(";");
  const headerString = headerEntries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const httpString = [
    input.method.toLowerCase(),
    input.path,
    "",
    headerString,
    ""
  ].join("\n");
  const stringToSign = [
    "sha1",
    keyTime,
    sha1(httpString),
    ""
  ].join("\n");
  const signKey = hmacSha1(input.secretKey, keyTime);
  const signature = hmacSha1(signKey, stringToSign);
  return [
    "q-sign-algorithm=sha1",
    `q-ak=${input.secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headerList}`,
    "q-url-param-list=",
    `q-signature=${signature}`
  ].join("&");
}

function extensionFromContentType(contentType: string): string {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) {
    return "jpg";
  }
  if (contentType.includes("webp")) {
    return "webp";
  }
  if (contentType.includes("gif")) {
    return "gif";
  }
  return "png";
}

function safePathPart(value: string): string {
  const safe = value.trim().replace(/[^a-zA-Z0-9_-]/g, "");
  return safe || "task";
}

function sha1(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function hmacSha1(key: string, value: string): string {
  return createHmac("sha1", key).update(value).digest("hex");
}
