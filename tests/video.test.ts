import { describe, expect, it } from "vitest";
import {
  createVideoTask,
  getVideoTask,
  normalizeSeedanceVideoPayload,
  normalizeVideoTaskStatus,
  prepareVideoTaskPayload
} from "../src/protocols/video.js";
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

  it("normalizes nested navos task responses", () => {
    const raw = {
      code: 200,
      data: {
        task_id: "task_2",
        status: "completed",
        data: {
          video_url: "https://cdn.test/final.mp4"
        }
      }
    };

    expect(normalizeVideoTaskStatus(raw)).toMatchObject({
      id: "task_2",
      status: "succeeded",
      videoUrl: "https://cdn.test/final.mp4"
    });
  });

  it("creates and polls video tasks through provider client", async () => {
    const paths: string[] = [];
    const client = new ProviderHttpClient("https://upstream.test", async (url, init) => {
      paths.push(`${init?.method ?? "GET"} ${new URL(String(url)).pathname}`);
      if (String(url).endsWith("/api/tasks/navos-seedance-video-generation")) {
        return Response.json({ task_id: "task_1", status: "queued" });
      }
      return Response.json({ task_id: "task_1", status: "success", video_url: "https://cdn.test/v.mp4" });
    });

    const created = await createVideoTask(client, { prompt: "city skyline" }, { authorization: "Bearer t" });
    const polled = await getVideoTask(client, "task_1", { authorization: "Bearer t" });

    expect(created.body).toMatchObject({ task_id: "task_1" });
    expect(polled.body).toMatchObject({ status: "succeeded", videoUrl: "https://cdn.test/v.mp4" });
    expect(paths).toEqual([
      "POST /api/tasks/navos-seedance-video-generation",
      "GET /api/tasks/video/generations/task_1"
    ]);
  });

  it("normalizes Seedance omni-reference payloads for image, video, audio and text prompt", () => {
    const payload = normalizeSeedanceVideoPayload({
      model: "doubao-seedance-2-0-260128",
      prompt: "make a cinematic short from these references",
      durationSeconds: "5",
      aspectRatio: "16:9",
      resolution: "720p",
      images: [
        "https://assets.test/first.png",
        { url: "https://assets.test/last.png", role: "last_frame" },
        "https://assets.test/style.png"
      ],
      imageRoles: ["first_frame", "last_frame", "reference_image"],
      videos: [
        "https://assets.test/motion-1.mp4",
        "https://assets.test/motion-2.mp4",
        "https://assets.test/motion-3.mp4",
        "https://assets.test/ignored.mp4"
      ],
      videoRoles: ["reference_video", "reference_video", "reference_video", "reference_video"],
      audioRefs: ["https://assets.test/music.mp3", "https://assets.test/beat.mp3"],
      audioRoles: ["reference_audio", "reference_audio"],
      watermark: false
    });

    expect(payload).toMatchObject({
      model: "navos/doubao-seedance-2-0-260128",
      prompt: "make a cinematic short from these references",
      duration: 5,
      durationSeconds: 5,
      aspectRatio: "16:9",
      resolution: "720P",
      audio: true,
      image: "https://assets.test/first.png",
      imageRoles: ["first_frame"],
      last_frame_image: "https://assets.test/last.png",
      image_tail_url: "https://assets.test/last.png",
      videos: [
        "https://assets.test/motion-1.mp4",
        "https://assets.test/motion-2.mp4",
        "https://assets.test/motion-3.mp4"
      ],
      videoRoles: ["reference_video", "reference_video", "reference_video"],
      audioRef: "https://assets.test/music.mp3",
      audioRefs: ["https://assets.test/beat.mp3"],
      audioRoles: ["reference_audio", "reference_audio"],
      metadata: {
        ratio: "16:9",
        resolution: "720P",
        generate_audio: true,
        reference_images: ["https://assets.test/style.png"],
        reference_videos: [
          "https://assets.test/motion-1.mp4",
          "https://assets.test/motion-2.mp4",
          "https://assets.test/motion-3.mp4"
        ],
        reference_audios: ["https://assets.test/music.mp3", "https://assets.test/beat.mp3"]
      }
    });
    expect(payload).not.toHaveProperty("images");
  });

  it("uploads local data URL references before creating a video payload", async () => {
    const paths: string[] = [];
    const client = new ProviderHttpClient("https://upstream.test", async (url) => {
      paths.push(new URL(String(url)).pathname);
      return Response.json({
        code: 200,
        data: { url: `https://cdn.test/ref-${paths.length}.bin` }
      });
    });

    const payload = await prepareVideoTaskPayload(
      client,
      {
        prompt: "use all media",
        images: ["data:image/png;base64,aGVsbG8=", "https://assets.test/style.png"],
        imageRoles: ["first_frame", "reference_image"],
        videos: ["data:video/mp4;base64,AAAA"],
        audioRefs: ["data:audio/mpeg;base64,AAAA"]
      },
      { authorization: "Bearer uid:token" }
    );

    expect(paths).toEqual([
      "/api/uploads/file",
      "/api/uploads/file",
      "/api/uploads/file"
    ]);
    expect(payload).toMatchObject({
      image: "https://cdn.test/ref-1.bin",
      videos: ["https://cdn.test/ref-2.bin"],
      audioRef: "https://cdn.test/ref-3.bin",
      metadata: {
        reference_images: ["https://assets.test/style.png"],
        reference_videos: ["https://cdn.test/ref-2.bin"],
        reference_audios: ["https://cdn.test/ref-3.bin"]
      }
    });
  });
});
