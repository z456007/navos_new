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
