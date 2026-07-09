import { describe, expect, it } from "vitest";
import { accountMetrics, panelTitle } from "../web/src/lib/accounts";
import { normalizeRegistrationJob, registrationJobIsTerminal } from "../web/src/lib/registration-job";
import { nextPollingDelay } from "../web/src/lib/polling";
import { archiveTone, normalizeVideoTask, videoDurationLimit } from "../web/src/lib/video-task";
import { buildVideoGenerationPayload } from "../web/src/lib/video-payload";
import type { AccountListItem } from "../web/src/types";

describe("web helper modules", () => {
  it("normalizes registration job data for polling", () => {
    const job = normalizeRegistrationJob({
      id: "job-1",
      mode: "fill",
      state: "completed",
      progress: { started: 2, completed: 1, failed: 1, total: 3 },
      logs: [{ at: 1000, level: "info", message: "started" }],
      createdAt: 900
    });

    expect(job).toMatchObject({
      id: "job-1",
      mode: "fill",
      state: "succeeded",
      progress: { started: 2, completed: 1, failed: 1, total: 3 }
    });
    expect(registrationJobIsTerminal(job)).toBe(true);
    expect(nextPollingDelay(0)).toBe(2000);
    expect(nextPollingDelay(1)).toBe(5000);
    expect(nextPollingDelay(2)).toBe(10000);
  });

  it("uses a deterministic fallback for malformed registration job logs", () => {
    const job = normalizeRegistrationJob({
      logs: [
        { level: "warn", message: "missing at" },
        { at: Number.NaN, level: "error", message: "invalid at" }
      ]
    });

    expect(job.logs).toEqual([
      { at: 0, level: "warn", message: "missing at" },
      { at: 0, level: "error", message: "invalid at" }
    ]);
  });

  it("maps registration job states from API values", () => {
    const cases = [
      ["completed", "succeeded"],
      ["succeeded", "succeeded"],
      ["active", "running"],
      ["running", "running"],
      ["failed", "failed"],
      ["canceled", "canceled"],
      ["unknown", "queued"],
      [undefined, "queued"]
    ] as const;

    for (const [rawState, expectedState] of cases) {
      expect(normalizeRegistrationJob({ state: rawState }).state).toBe(expectedState);
    }
  });

  it("treats only final registration job states as terminal", () => {
    const cases = [
      ["queued", false],
      ["running", false],
      ["succeeded", true],
      ["failed", true],
      ["canceled", true]
    ] as const;

    for (const [state, expected] of cases) {
      const job = normalizeRegistrationJob({ state });
      expect(registrationJobIsTerminal(job)).toBe(expected);
    }
  });

  it("normalizes video task data for the UI", () => {
    const task = normalizeVideoTask(
      {
        code: 200,
        data: {
          task_id: "task_1",
          status: "success",
          cos_url: "https://cdn.example.com/task_1.mp4",
          archive_status: "archived",
          size_bytes: "1234"
        }
      },
      "fallback"
    );

    expect(task).toMatchObject({
      id: "task_1",
      status: "succeeded",
      cosUrl: "https://cdn.example.com/task_1.mp4",
      archiveStatus: "archived",
      sizeBytes: 1234
    });
    expect(videoDurationLimit("1080P")).toBe(5);
    expect(videoDurationLimit("unknown")).toBe(10);
    expect(archiveTone("failed")).toBe("bad");
  });

  it("builds video payloads with text, image, video and audio references", () => {
    const payload = buildVideoGenerationPayload(
      {
        model: "navos/doubao-seedance-2-0-260128",
        prompt: "base prompt",
        resolution: "720P",
        aspectRatio: "16:9",
        durationSeconds: 5,
        audio: false
      },
      {
        referenceText: "keep the product color and slogan",
        images: [{ source: "https://assets.test/ref.png", role: "reference_image" }],
        videos: [{ source: "https://assets.test/motion.mp4", role: "reference_video" }],
        audios: [{ source: "https://assets.test/music.mp3", role: "reference_audio" }]
      }
    );

    expect(payload).toMatchObject({
      model: "navos/doubao-seedance-2-0-260128",
      prompt: "base prompt\n\n参考文字：keep the product color and slogan",
      resolution: "720P",
      aspectRatio: "16:9",
      durationSeconds: 5,
      audio: true,
      mode: "omni_reference",
      generation_mode: "omni_reference",
      images: ["https://assets.test/ref.png"],
      imageRoles: ["reference_image"],
      videos: ["https://assets.test/motion.mp4"],
      videoRoles: ["reference_video"],
      audioRefs: ["https://assets.test/music.mp3"],
      audioRoles: ["reference_audio"]
    });
  });

  it("summarizes account pool state and panel labels", () => {
    const now = Date.now();
    const accounts: AccountListItem[] = [
      account("a", "active", now - 1),
      account("b", "active", now + 60_000),
      account("c", "disabled", 0),
      account("d", "depleted", 0)
    ];

    expect(accountMetrics(accounts)).toEqual({
      total: 4,
      active: 1,
      cooldown: 1,
      blocked: 2
    });
    expect(panelTitle("video")).toBe("视频生成");
    expect(panelTitle("accounts")).toBe("账号池");
  });
});

function account(uid: string, status: AccountListItem["status"], rateLimitedUntil: number): AccountListItem {
  return {
    uid,
    status,
    rateLimitedUntil,
    tokenPreview: "",
    balanceRemaining: 0,
    balanceTotal: 0,
    createdAt: 0,
    lastUsedAt: 0,
    lastBalanceAt: 0
  };
}
