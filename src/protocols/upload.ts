import type { ProviderResult } from "./http.js";
import { ProviderHttpClient } from "./http.js";

export interface UploadAssetInput {
  source: string;
  filename?: string;
  headers: Record<string, string>;
}

function parseDataUrl(source: string): { mimeType: string; bytes: Uint8Array } {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(source);
  if (!match) {
    throw new Error("Invalid base64 data URL upload source");
  }
  return {
    mimeType: match[1] ?? "application/octet-stream",
    bytes: Buffer.from(match[2] ?? "", "base64")
  };
}

function isRemoteUrl(source: string): boolean {
  try {
    const parsed = new URL(source);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function uploadAsset<T = unknown>(
  client: ProviderHttpClient,
  input: UploadAssetInput
): Promise<ProviderResult<T>> {
  if (input.source.startsWith("data:")) {
    const parsed = parseDataUrl(input.source);
    const form = new FormData();
    const arrayBuffer = new ArrayBuffer(parsed.bytes.byteLength);
    new Uint8Array(arrayBuffer).set(parsed.bytes);
    const blob = new Blob([arrayBuffer], { type: parsed.mimeType });
    form.append("file", blob, input.filename ?? "upload.bin");
    return client.request<T>("POST", "/api/uploads/file", {
      body: form,
      headers: input.headers
    });
  }

  if (isRemoteUrl(input.source)) {
    return client.requestJson<T>("POST", "/api/uploads/url", { url: input.source }, input.headers);
  }

  throw new Error("Upload source must be a data URL or http(s) URL");
}

export function extractUploadUrl(body: unknown): string | undefined {
  const records = uploadCandidateRecords(body);
  for (const record of records) {
    for (const key of ["url", "fileUrl", "file_url", "ossUrl", "oss_url"]) {
      const value = record[key];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
  }
  return undefined;
}

export async function uploadAssetToUrl(
  client: ProviderHttpClient,
  input: UploadAssetInput
): Promise<string> {
  const result = await uploadAsset(client, input);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Upload failed: ${result.status}`);
  }
  const url = extractUploadUrl(result.body);
  if (!url) {
    throw new Error("Upload response did not include a URL");
  }
  return url;
}

function uploadCandidateRecords(raw: unknown): Record<string, unknown>[] {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
