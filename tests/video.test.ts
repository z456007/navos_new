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
    expect(normalizeVideoTaskStatus({ data: { task_id: "task_asset", status: "asset_pending" } })).toMatchObject({
      id: "task_asset",
      status: "running"
    });
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
      generate_audio: true,
      size: "16:9",
      image_with_roles: [
        { url: "https://assets.test/first.png", role: "first_frame" },
        { url: "https://assets.test/last.png", role: "last_frame" }
      ],
      image_urls: ["https://assets.test/style.png"],
      video_urls: [
        "https://assets.test/motion-1.mp4",
        "https://assets.test/motion-2.mp4",
        "https://assets.test/motion-3.mp4"
      ],
      audio_urls: ["https://assets.test/music.mp3", "https://assets.test/beat.mp3"],
      metadata: {
        ratio: "16:9",
        resolution: "720P",
        generate_audio: true
      }
    });
    expect(payload).not.toHaveProperty("images");
  });

  it("treats blank video model values as the default Seedance model", () => {
    expect(normalizeSeedanceVideoPayload({ prompt: "city skyline", model: "   " })).toMatchObject({
      model: "navos/doubao-seedance-2-0-260128"
    });
  });

  it("keeps explicit generic reference images as official image_urls instead of promoting them to the first frame field", () => {
    const payload = normalizeSeedanceVideoPayload({
      prompt: "animate this style reference",
      images: ["https://assets.test/style.png"],
      imageRoles: ["reference_image"]
    });

    expect(payload).not.toHaveProperty("image");
    expect(payload).not.toHaveProperty("imageRoles");
    expect(payload).toMatchObject({ image_urls: ["https://assets.test/style.png"] });
    expect(payload).not.toHaveProperty("metadata.reference_images");
  });

  it("maps generic Seedance references to official image_urls video_urls and audio_urls fields", () => {
    const payload = normalizeSeedanceVideoPayload({
      prompt: "combine these references",
      images: ["https://assets.test/style.png"],
      imageRoles: ["reference_image"],
      videos: ["https://assets.test/motion.mp4"],
      audioRefs: ["https://assets.test/music.mp3"],
      audioRoles: ["reference_audio"],
      mode: "omni_reference",
      generation_mode: "omni_reference"
    });

    expect(payload).toMatchObject({
      image_urls: ["https://assets.test/style.png"],
      video_urls: ["https://assets.test/motion.mp4"],
      audio_urls: ["https://assets.test/music.mp3"],
      generate_audio: true,
      size: "16:9"
    });
    expect(payload).not.toHaveProperty("image");
    expect(payload).not.toHaveProperty("videos");
    expect(payload).not.toHaveProperty("audioRef");
    expect(payload).not.toHaveProperty("metadata.reference_images");
  });

  it("maps first and last frame references to official image_with_roles fields", () => {
    const payload = normalizeSeedanceVideoPayload({
      prompt: "transition between frames",
      images: ["https://assets.test/start.png", "https://assets.test/end.png"],
      imageRoles: ["first_frame", "last_frame"]
    });

    expect(payload).toMatchObject({
      image_with_roles: [
        { url: "https://assets.test/start.png", role: "first_frame" },
        { url: "https://assets.test/end.png", role: "last_frame" }
      ]
    });
    expect(payload).not.toHaveProperty("image");
    expect(payload).not.toHaveProperty("last_frame_image");
    expect(payload).not.toHaveProperty("image_tail_url");
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
      image_with_roles: [{ url: "https://cdn.test/ref-1.bin", role: "first_frame" }],
      image_urls: ["https://assets.test/style.png"],
      video_urls: ["https://cdn.test/ref-2.bin"],
      audio_urls: ["https://cdn.test/ref-3.bin"]
    });
  });
});
