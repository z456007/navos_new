export interface ImageGenerationForm {
  model: string;
  prompt: string;
  size: string;
  quality: string;
  count: number;
}

export interface ImageResult {
  url: string;
}

export function buildImageGenerationRequest(form: ImageGenerationForm): Record<string, unknown> {
  return {
    model: form.model.trim() || "gpt-image-2",
    prompt: form.prompt.trim(),
    n: Math.max(1, Math.min(4, Math.floor(form.count || 1))),
    quality: form.quality,
    size: form.size
  };
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
      if (typeof record.b64_json === "string" && record.b64_json) {
        return { url: `data:image/png;base64,${record.b64_json}` };
      }
      if (typeof record.url === "string" && record.url) {
        return { url: record.url };
      }
      return undefined;
    })
    .filter((item): item is ImageResult => item !== undefined);
}
