import { describe, expect, it } from "vitest";
import { uploadAsset } from "../src/protocols/upload.js";
import { ProviderHttpClient } from "../src/protocols/http.js";

describe("uploadAsset", () => {
  it("uploads a data URL as multipart form data", async () => {
    let captured: RequestInit | undefined;
    const client = new ProviderHttpClient("https://upstream.test", async (_url, init) => {
      captured = init;
      return new Response(JSON.stringify({ url: "https://cdn.test/a.png" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    const result = await uploadAsset(client, {
      source: "data:image/png;base64,aGVsbG8=",
      filename: "a.png",
      headers: { authorization: "Bearer t" }
    });

    expect(result.body).toEqual({ url: "https://cdn.test/a.png" });
    expect(captured?.body).toBeInstanceOf(FormData);
    expect(captured?.headers).toMatchObject({ authorization: "Bearer t" });
  });

  it("forwards remote URL uploads as JSON", async () => {
    let captured: RequestInit | undefined;
    const client = new ProviderHttpClient("https://upstream.test", async (_url, init) => {
      captured = init;
      return new Response(JSON.stringify({ id: "file_1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    await uploadAsset(client, {
      source: "https://assets.test/a.png",
      headers: { authorization: "Bearer t" }
    });

    expect(captured?.body).toBe(JSON.stringify({ url: "https://assets.test/a.png" }));
  });
});

