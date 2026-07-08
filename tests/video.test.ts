import { describe, expect, it } from "vitest";
import { createVideoTask, getVideoTask, normalizeVideoTaskStatus } from "../src/protocols/video.js";
import { ProviderHttpClient } from "../src/protocols/http.js";

describe("video protocol", () => {
  it("normalizes common upstream task statuses", () => {
    expect(normalizeVideoTaskStatus({ status: "success", video_url: "https://cdn.test/v.mp4" })).toEqual({
      id: undefined,
      status: "succeeded",
      videoUrl: "https://cdn.test/v.mp4",
      error: undefined,
      raw: { status: "success", video_url: "https://cdn.test/v.mp4" }
    });
    expect(normalizeVideoTaskStatus({ status: "failed", error: "bad prompt" }).status).toBe("failed");
    expect(normalizeVideoTaskStatus({ status: "running" }).status).toBe("running");
  });

  it("creates and polls video tasks through provider client", async () => {
    const paths: string[] = [];
    const client = new ProviderHttpClient("https://upstream.test", async (url, init) => {
      paths.push(`${init?.method ?? "GET"} ${new URL(String(url)).pathname}`);
      if (String(url).endsWith("/api/video/generations")) {
        return Response.json({ task_id: "task_1", status: "queued" });
      }
      return Response.json({ task_id: "task_1", status: "success", video_url: "https://cdn.test/v.mp4" });
    });

    const created = await createVideoTask(client, { prompt: "city skyline" }, { authorization: "Bearer t" });
    const polled = await getVideoTask(client, "task_1", { authorization: "Bearer t" });

    expect(created.body).toMatchObject({ task_id: "task_1" });
    expect(polled.body).toMatchObject({ status: "succeeded", videoUrl: "https://cdn.test/v.mp4" });
    expect(paths).toEqual(["POST /api/video/generations", "GET /api/video/generations/task_1"]);
  });
});

