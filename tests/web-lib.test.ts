import { describe, expect, it } from "vitest";
import { accountMetrics, panelTitle } from "../web/src/lib/accounts";
import { archiveTone, normalizeVideoTask, videoDurationLimit } from "../web/src/lib/video-task";
import type { AccountListItem } from "../web/src/types";

describe("web helper modules", () => {
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
