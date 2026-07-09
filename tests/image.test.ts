import { describe, expect, it } from "vitest";
import { buildImageGenerationPayload, imageResponseToResults } from "../src/protocols/image.js";

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
});
