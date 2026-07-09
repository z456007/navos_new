// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../web/src/App";

describe("admin app gate", () => {
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("requires a verified master api key before showing the console", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer sk-local" });
      return Response.json([{
        uid: "u1",
        tokenPreview: "token-ab...",
        mailboxAddr: "a@mail.test",
        status: "active",
        balanceRemaining: 1500,
        balanceTotal: 2000,
        rateLimitedUntil: 0,
        createdAt: 0,
        lastUsedAt: 0,
        lastBalanceAt: 1000
      }]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(screen.getByRole("heading", { name: "进入 Navos 控制台" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "账号池" })).not.toBeInTheDocument();
    expect(screen.queryByText("AUTH")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Master API Key"), { target: { value: "sk-local" } });
    fireEvent.click(screen.getByRole("button", { name: "进入控制台" }));

    await waitFor(() => {
      expect(screen.getAllByRole("heading", { name: "账号池" }).length).toBeGreaterThan(0);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/accounts", expect.objectContaining({ method: "GET" }));
    expect(screen.getByText("剩余额度")).toBeInTheDocument();
    expect(screen.getByText("1500 / 2000")).toBeInTheDocument();
    expect(localStorage.getItem("navos.admin.apiKey")).toBe("sk-local");
  });

  it("creates and polls a video task from the console", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer sk-local" });
      const path = String(url);
      if (path === "/api/accounts") {
        return Response.json([]);
      }
      if (path === "/api/video/generations") {
        return Response.json({
          code: 200,
          data: { task_id: "task_1", status: "deducted" }
        });
      }
      if (path === "/api/video/generations/task_1") {
        return Response.json({
          id: "task_1",
          status: "succeeded",
          videoUrl: "https://cdn.test/video.mp4",
          cosUrl: "https://cdn.example.com/navos/videos/task_1.mp4",
          archiveStatus: "archived",
          raw: { code: 200 }
        });
      }
      return Response.json({ error: { message: "unexpected path" } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("Master API Key"), { target: { value: "sk-local" } });
    fireEvent.click(screen.getByRole("button", { name: "进入控制台" }));

    await screen.findByRole("button", { name: "视频生成" });
    fireEvent.click(screen.getByRole("button", { name: "视频生成" }));

    fireEvent.change(screen.getByLabelText("提示词"), {
      target: { value: "原创极简动画短片：白色机器人在桌面挥手。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "创建视频任务" }));

    await waitFor(() => {
      expect(screen.getByText("task_1")).toBeInTheDocument();
      expect(screen.getByText("succeeded")).toBeInTheDocument();
    });

    expect(screen.getByTitle("生成视频")).toHaveAttribute("src", "https://cdn.example.com/navos/videos/task_1.mp4");
    expect(screen.getByText("archived")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/video/generations", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/video/generations/task_1", expect.objectContaining({ method: "GET" }));
  });

  it("starts and renders a single registration job from the account pool", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer sk-local" });
      const path = String(url);
      if (path === "/api/accounts") {
        return Response.json([]);
      }
      if (path === "/api/registration/jobs" && init?.method === "GET") {
        return Response.json([]);
      }
      if (path === "/api/registration/jobs" && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ mode: "single" });
        return Response.json({ jobId: "job-1" });
      }
      if (path === "/api/registration/jobs/job-1") {
        return Response.json({
          id: "job-1",
          mode: "single",
          state: "succeeded",
          progress: { started: 1, completed: 1, failed: 0, total: 1 },
          logs: [{ at: 1000, level: "info", message: "single registration completed" }],
          results: { uid: "uid-full-1", token: "token-full-1" },
          createdAt: 900,
          startedAt: 950,
          finishedAt: 1000
        });
      }
      return Response.json({ error: { message: "unexpected path" } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("Master API Key"), { target: { value: "sk-local" } });
    fireEvent.click(screen.getByRole("button", { name: "进入控制台" }));

    await waitFor(() => {
      expect(screen.getAllByRole("heading", { name: "账号池" }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "启动单个注册" }));

    await waitFor(() => {
      expect(screen.getByText("job-1")).toBeInTheDocument();
      expect(screen.getByText("succeeded")).toBeInTheDocument();
      expect(screen.getByText(/single registration completed/)).toBeInTheDocument();
    });
    expect(screen.getByText(/uid-full-1/)).toBeInTheDocument();
    expect(screen.getByText(/token-full-1/)).toBeInTheDocument();
  });

  it("keeps polling a running registration job after cancel fails", async () => {
    vi.useFakeTimers();
    let jobPolls = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer sk-local" });
      const path = String(url);
      if (path === "/api/accounts") {
        return Response.json([]);
      }
      if (path === "/api/registration/jobs" && init?.method === "GET") {
        return Response.json([{
          id: "job-cancel",
          mode: "fill",
          state: "running",
          progress: { started: 1, completed: 0, failed: 0, total: 2 },
          logs: [{ at: 1000, level: "info", message: "fill registration started" }],
          createdAt: 900
        }]);
      }
      if (path === "/api/registration/jobs/job-cancel/cancel" && init?.method === "POST") {
        return Response.json({ error: { message: "cancel unavailable" } }, { status: 503 });
      }
      if (path === "/api/registration/jobs/job-cancel" && init?.method === "GET") {
        jobPolls += 1;
        return Response.json({
          id: "job-cancel",
          mode: "fill",
          state: "running",
          progress: { started: 1, completed: 0, failed: 0, total: 2 },
          logs: [{ at: 2000, level: "warn", message: "cancel failed, still running" }],
          createdAt: 900
        });
      }
      return Response.json({ error: { message: "unexpected path" } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("Master API Key"), { target: { value: "sk-local" } });
    fireEvent.click(screen.getByRole("button", { name: "进入控制台" }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("job-cancel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消任务" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("cancel unavailable")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(jobPolls).toBeGreaterThan(0);
    expect(screen.getByText("job-cancel")).toBeInTheDocument();
  });

  it("does not let slow recent registration jobs replace a newly started job", async () => {
    const recentJobs = deferred<Response>();
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer sk-local" });
      const path = String(url);
      if (path === "/api/accounts") {
        return Response.json([]);
      }
      if (path === "/api/registration/jobs" && init?.method === "GET") {
        return recentJobs.promise;
      }
      if (path === "/api/registration/jobs" && init?.method === "POST") {
        return Response.json({ jobId: "job-new" });
      }
      if (path === "/api/registration/jobs/job-new" && init?.method === "GET") {
        return Response.json({
          id: "job-new",
          mode: "single",
          state: "running",
          progress: { started: 1, completed: 0, failed: 0, total: 1 },
          logs: [{ at: 2000, level: "info", message: "new registration started" }],
          createdAt: 1900
        });
      }
      return Response.json({ error: { message: "unexpected path" } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("Master API Key"), { target: { value: "sk-local" } });
    fireEvent.click(screen.getByRole("button", { name: "进入控制台" }));

    await waitFor(() => {
      expect(screen.getAllByRole("heading", { name: "账号池" }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "启动单个注册" }));

    await screen.findByText("job-new");

    await act(async () => {
      recentJobs.resolve(Response.json([{
        id: "job-old",
        mode: "fill",
        state: "running",
        progress: { started: 1, completed: 0, failed: 0, total: 3 },
        logs: [{ at: 1000, level: "info", message: "old registration running" }],
        createdAt: 800
      }]));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("job-new")).toBeInTheDocument();
    expect(screen.queryByText("job-old")).not.toBeInTheDocument();
  });

  it("ignores an old cancel response after a newer registration job starts", async () => {
    const cancelOldJob = deferred<Response>();
    let oldJobPolls = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer sk-local" });
      const path = String(url);
      if (path === "/api/accounts") {
        return Response.json([]);
      }
      if (path === "/api/registration/jobs" && init?.method === "GET") {
        return Response.json([{
          id: "job-old",
          mode: "fill",
          state: "running",
          progress: { started: 1, completed: 0, failed: 0, total: 3 },
          logs: [{ at: 1000, level: "info", message: "old registration running" }],
          createdAt: 900
        }]);
      }
      if (path === "/api/registration/jobs/job-old/cancel" && init?.method === "POST") {
        return cancelOldJob.promise;
      }
      if (path === "/api/registration/jobs" && init?.method === "POST") {
        return Response.json({ jobId: "job-new" });
      }
      if (path === "/api/registration/jobs/job-new" && init?.method === "GET") {
        return Response.json({
          id: "job-new",
          mode: "single",
          state: "running",
          progress: { started: 1, completed: 0, failed: 0, total: 1 },
          logs: [{ at: 2000, level: "info", message: "new registration started" }],
          createdAt: 1900
        });
      }
      if (path === "/api/registration/jobs/job-old" && init?.method === "GET") {
        oldJobPolls += 1;
        return Response.json({
          id: "job-old",
          mode: "fill",
          state: "running",
          progress: { started: 1, completed: 0, failed: 0, total: 3 },
          logs: [{ at: 3000, level: "info", message: "old registration polled" }],
          createdAt: 900
        });
      }
      return Response.json({ error: { message: "unexpected path" } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("Master API Key"), { target: { value: "sk-local" } });
    fireEvent.click(screen.getByRole("button", { name: "进入控制台" }));

    await screen.findByText("job-old");
    fireEvent.click(screen.getByRole("button", { name: "取消任务" }));
    fireEvent.click(screen.getByRole("button", { name: "启动单个注册" }));

    await screen.findByText("job-new");

    await act(async () => {
      cancelOldJob.resolve(Response.json({
        id: "job-old",
        mode: "fill",
        state: "canceled",
        progress: { started: 1, completed: 0, failed: 0, total: 3 },
        logs: [{ at: 2500, level: "warn", message: "old registration canceled" }],
        createdAt: 900,
        finishedAt: 2500
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("job-new")).toBeInTheDocument();
    expect(screen.queryByText("job-old")).not.toBeInTheDocument();
    expect(oldJobPolls).toBe(0);
  });

  it("shows video duration rules and clamps 1080P to five seconds", async () => {
    const fetchMock = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("Master API Key"), { target: { value: "sk-local" } });
    fireEvent.click(screen.getByRole("button", { name: "进入控制台" }));

    await screen.findByRole("button", { name: "视频生成" });
    fireEvent.click(screen.getByRole("button", { name: "视频生成" }));

    expect(screen.getByText("480P / 15秒")).toBeInTheDocument();
    expect(screen.getByText("720P / 10秒")).toBeInTheDocument();
    expect(screen.getByText("1080P / 5秒")).toBeInTheDocument();
    expect(screen.getByText("生成前会自动准备一个一次性账号")).toBeInTheDocument();
    expect(screen.getByText("账号池没有可用账号时会自动注册；每个账号只用于一个视频任务。")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("分辨率"), { target: { value: "1080P" } });
    expect(screen.getByLabelText("时长")).toHaveAttribute("max", "5");
  });

  it("saves COS config from the console without exposing secrets", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer sk-local" });
      const path = String(url);
      if (path === "/api/accounts") {
        return Response.json([]);
      }
      if (path === "/api/cos/config" && init?.method === "GET") {
        return Response.json({ configured: false });
      }
      if (path === "/api/cos/config" && init?.method === "PUT") {
        const payload = JSON.parse(String(init.body));
        expect(payload.secretId).toBe("secret-id");
        expect(payload.secretKey).toBe("secret-key");
        return Response.json({
          id: 1,
          name: "main",
          enabled: true,
          secretIdConfigured: true,
          secretKeyConfigured: true,
          bucket: "bucket-123456",
          region: "ap-shanghai",
          uploadPrefix: "navos/videos",
          createdAt: 1,
          updatedAt: 2
        });
      }
      return Response.json({ error: { message: "unexpected path" } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("Master API Key"), { target: { value: "sk-local" } });
    fireEvent.click(screen.getByRole("button", { name: "进入控制台" }));

    await screen.findByRole("button", { name: "COS配置" });
    fireEvent.click(screen.getByRole("button", { name: "COS配置" }));

    fireEvent.change(await screen.findByLabelText("SecretId"), { target: { value: "secret-id" } });
    fireEvent.change(screen.getByLabelText("SecretKey"), { target: { value: "secret-key" } });
    fireEvent.change(screen.getByLabelText("Bucket"), { target: { value: "bucket-123456" } });
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "ap-shanghai" } });
    fireEvent.click(screen.getByRole("button", { name: "保存COS配置" }));

    await screen.findByText("已保存");
    expect(screen.queryByText("secret-key")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/cos/config", expect.objectContaining({ method: "PUT" }));
  });

  it("saves YYDS Mail config from the console without exposing the key", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer sk-local" });
      const path = String(url);
      if (path === "/api/accounts") {
        return Response.json([]);
      }
      if (path === "/api/mail/yyds/config" && init?.method === "GET") {
        return Response.json({ configured: false });
      }
      if (path === "/api/mail/yyds/config" && init?.method === "PUT") {
        const payload = JSON.parse(String(init.body));
        expect(payload.apiKey).toBe("ac-ui-key");
        return Response.json({
          id: 1,
          enabled: true,
          apiKeyConfigured: true,
          createdAt: 1,
          updatedAt: 2
        });
      }
      return Response.json({ error: { message: "unexpected path" } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("Master API Key"), { target: { value: "sk-local" } });
    fireEvent.click(screen.getByRole("button", { name: "进入控制台" }));

    await screen.findByRole("button", { name: "YYDS配置" });
    fireEvent.click(screen.getByRole("button", { name: "YYDS配置" }));

    fireEvent.change(await screen.findByLabelText("YYDS Mail Key"), { target: { value: "ac-ui-key" } });
    fireEvent.click(screen.getByRole("button", { name: "保存YYDS配置" }));

    await screen.findByText("已保存");
    expect(screen.queryByText("ac-ui-key")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/mail/yyds/config", expect.objectContaining({ method: "PUT" }));
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}
