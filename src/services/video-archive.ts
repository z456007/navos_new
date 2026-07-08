import { createHash, createHmac, randomBytes } from "node:crypto";
import type { FetchLike } from "../protocols/http.js";
import type { EnabledCosConfig } from "./cos-config-service.js";

export interface ArchiveVideoInput {
  taskId: string;
  sourceUrl: string;
  config: EnabledCosConfig;
  fetchImpl?: FetchLike;
  now?: () => Date;
  randomHex?: (bytes: number) => string;
}

export interface ArchiveVideoResult {
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

export async function archiveVideoToCos(input: ArchiveVideoInput): Promise<ArchiveVideoResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(input.sourceUrl);
  if (!response.ok) {
    throw new Error(`download video failed: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error("downloaded video is empty");
  }
  const contentType = response.headers.get("content-type") || "video/mp4";
  if (!contentType.includes("video") && !input.sourceUrl.toLowerCase().endsWith(".mp4")) {
    throw new Error(`downloaded file is not video: ${contentType}`);
  }

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const key = buildVideoCosKey({
    taskId: input.taskId,
    prefix: input.config.uploadPrefix,
    now: input.now?.() ?? new Date(),
    randomHex: input.randomHex ?? ((bytes) => randomBytes(bytes).toString("hex"))
  });

  await putCosObject({
    secretId: input.config.secretId,
    secretKey: input.config.secretKey,
    bucket: input.config.bucket,
    region: input.config.region,
    key,
    body: buffer,
    contentType,
    fetchImpl
  });

  return {
    cosUrl: buildCosPublicUrl(input.config, key),
    cosKey: key,
    sizeBytes: buffer.length,
    sha256
  };
}

export function buildVideoCosKey(input: {
  taskId: string;
  prefix: string;
  now: Date;
  randomHex: (bytes: number) => string;
}): string {
  const prefix = input.prefix.replace(/^\/+|\/+$/g, "") || "navos/videos";
  const year = input.now.getFullYear();
  const month = String(input.now.getMonth() + 1).padStart(2, "0");
  const day = String(input.now.getDate()).padStart(2, "0");
  return `${prefix}/${year}/${month}/${day}/${safePathPart(input.taskId)}_${input.randomHex(4)}.mp4`;
}

export function buildCosPublicUrl(config: Pick<EnabledCosConfig, "bucket" | "region" | "publicDomain">, key: string): string {
  const normalizedKey = key.split("/").map(encodeURIComponent).join("/");
  if (config.publicDomain) {
    return `${config.publicDomain.replace(/\/+$/g, "")}/${normalizedKey}`;
  }
  return `https://${config.bucket}.cos.${config.region}.myqcloud.com/${normalizedKey}`;
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
