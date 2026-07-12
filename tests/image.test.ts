import { describe, expect, it } from "vitest";
import {
  buildImageGenerationPayload,
  imageResponseToDisplayResults,
  imageResponseToResults,
  normalizeOpenAIImageData,
  normalizePolledImageTaskForTest
} from "../src/protocols/image.js";

describe("image protocol", () => {
  it("builds a normalized gpt-image-2 generation payload", () => {
    expect(buildImageGenerationPayload({
      prompt: "?????????????",
      n: 9,
      quality: "high",
      size: "1536x1024"
    })).toEqual({
      model: "gpt-image-2",
      prompt: "?????????????",
      n: 4,
      quality: "high",
      size: "1536x1024",
      response_format: "b64_json",
      output_format: "png"
    });
  });

  it("rejects empty prompts", () => {
    expect(() => buildImageGenerationPayload({ prompt: "   " })).toThrow("prompt is required");
  });

  it("extracts data URLs and URLs from image responses", () => {
    expect(imageResponseToResults({
      data: [
        { b64_json: "aGVsbG8=" },
        { url: "https://cdn.test/image.png" }
      ]
    })).toEqual([
      { url: "data:image/png;base64,aGVsbG8=" },
      { url: "https://cdn.test/image.png" }
    ]);
  });

  it("keeps b64_json in public OpenAI b64_json responses", () => {
    expect(normalizeOpenAIImageData({
      data: [{ b64_json: "aGVsbG8=", url: "https://cdn.test/ignored.png", sizeBytes: 5, sha256: "hash-1" }]
    }, "b64_json")).toEqual([
      { b64_json: "aGVsbG8=", sizeBytes: 5, sha256: "hash-1" }
    ]);
  });

  it("keeps remote URLs in public OpenAI url responses", () => {
    expect(normalizeOpenAIImageData({
      data: [{ url: "https://cdn.test/image.png", b64_json: "ignored", size_bytes: 7, sha256: "hash-2" }]
    }, "url")).toEqual([
      { url: "https://cdn.test/image.png", sizeBytes: 7, sha256: "hash-2" }
    ]);
  });

  it("uses display data URLs only for admin display helpers", () => {
    expect(imageResponseToDisplayResults({
      data: [{ b64_json: "aGVsbG8=", sizeBytes: 5, sha256: "hash-1" }]
    })).toEqual([
      { url: "data:image/png;base64,aGVsbG8=", sizeBytes: 5, sha256: "hash-1" }
    ]);
    expect(normalizeOpenAIImageData({
      data: [{ b64_json: "aGVsbG8=", sizeBytes: 5, sha256: "hash-1" }]
    }, "b64_json")).toEqual([
      { b64_json: "aGVsbG8=", sizeBytes: 5, sha256: "hash-1" }
    ]);
  });

  it("prefers extracted image data even when task status says failed", () => {
    expect(normalizePolledImageTaskForTest({
      status: 200,
      headers: new Headers(),
      body: {
        code: 200,
        data: {
          status: "failed",
          error: "late status drift",
          images: [{ url: "https://cdn.test/recovered.png" }]
        }
      }
    }, "img_recovered", "url")).toMatchObject({
      status: 200,
      body: {
        status: "succeeded",
        task_id: "img_recovered",
        data: [{ url: "https://cdn.test/recovered.png" }]
      }
    });
  });
});
