export interface ImageGenerationForm {
  model: string;
  prompt: string;
  size: string;
  quality: string;
  count: number;
  referenceImages?: string[];
}

export interface ImageResult {
  url: string;
}

export function buildImageGenerationRequest(form: ImageGenerationForm): Record<string, unknown> {
  const references = (form.referenceImages ?? []).map((item) => item.trim()).filter(Boolean).slice(0, 8);
  const payload: Record<string, unknown> = {
    model: form.model.trim() || "gpt-image-2",
    prompt: form.prompt.trim(),
    n: Math.max(1, Math.min(4, Math.floor(form.count || 1))),
    quality: form.quality,
    size: form.size
  };
  if (references.length > 0) {
    payload.images = references;
  }
  return payload;
}

export function parseImageGenerationResults(response: unknown): ImageResult[] {
  if (!response || typeof response !== "object" || !Array.isArray((response as { data?: unknown }).data)) {
    return [];
  }
  return ((response as { data: unknown[] }).data)
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      const result: ImageResult = { url: "" };
      if (typeof record.b64_json === "string" && record.b64_json) {
        result.url = `data:image/png;base64,${record.b64_json}`;
      } else if (typeof record.url === "string" && record.url) {
        result.url = record.url;
      } else {
        return undefined;
      }
      return result;
    })
    .filter((item): item is ImageResult => item !== undefined);
}

export function parseImageReferenceUrls(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
}
