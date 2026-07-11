// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../web/src/App";
import { ConsoleShell } from "../web/src/app/ConsoleShell";

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
    expect(screen.getAllByText("剩余额度").length).toBeGreaterThan(0);
    expect(screen.getByText("1500 / 2000")).toBeInTheDocument();
    expect(localStorage.getItem("navos.admin.apiKey")).toBe("sk-local");
  });

  it("hides manual mailbox and account import controls in the automation console", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer sk-local" });
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("Master API Key"), { target: { value: "sk-local" } });
    fireEvent.click(screen.getByRole("button", { name: "进入控制台" }));

    await waitFor(() => {
      expect(screen.getAllByRole("heading", { name: "账号池" }).length).toBeGreaterThan(0);
    });

    expect(screen.queryByRole("button", { name: "YYDS 邮箱" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导入账号" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("UID")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("邮箱 Token")).not.toBeInTheDocument();
  });

  it("puts config navigation at the bottom and adds a chat menu", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer sk-local" });
      const path = String(url);
      if (path === "/api/accounts") {
        return Response.json([]);
      }
      if (path === "/api/registration/jobs" && init?.method === "GET") {
        return Response.json([]);
      }
      return Response.json({ error: { message: "unexpected path" } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("Master API Key"), { target: { value: "sk-local" } });
    fireEvent.click(screen.getByRole("button", { name: "进入控制台" }));

    const primaryNav = await screen.findByLabelText("主功能菜单");
    const configNav = screen.getByLabelText("配置菜单");

    expect(within(primaryNav).getByRole("button", { name: "账号池" })).toBeInTheDocument();
    expect(within(primaryNav).getByRole("button", { name: "聊天" })).toBeInTheDocument();
    expect(within(primaryNav).getByRole("button", { name: "图片生成" })).toBeInTheDocument();
    expect(within(primaryNav).getByRole("button", { name: "视频生成" })).toBeInTheDocument();
    expect(within(primaryNav).queryByRole("button", { name: "YYDS配置" })).not.toBeInTheDocument();
    expect(within(configNav).getByRole("button", { name: "YYDS配置" })).toBeInTheDocument();
    expect(within(configNav).queryByRole("button", { name: /COS/ })).not.toBeInTheDocument();
  });

  it("generates images from the image workbench", async () => {
    const prompt = "白色机器人站在霓虹雨夜的天桥上";
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer sk-local" });
      const path = String(url);
      if (path === "/api/accounts") {
        return Response.json([]);
      }
      if (path === "/api/images/generations" && init?.method === "POST") {
        const payload = JSON.parse(String(init.body));
        expect(payload).toMatchObject({
          model: "gpt-image-2",
          prompt,
          n: 1,
          quality: "auto",
          size: "1024x1024"
        });
        return Response.json({ data: [{ b64_json: "aGVsbG8=" }] });
      }
      return Response.json({ error: { message: `unexpected path ${path}` } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("Master API Key"), { target: { value: "sk-local" } });
    fireEvent.click(screen.getByRole("button", { name: "进入控制台" }));

    await screen.findByRole("button", { name: "图片生成" });
    fireEvent.click(screen.getByRole("button", { name: "图片生成" }));

    fireEvent.change(screen.getByLabelText("Image prompt"), { target: { value: prompt } });
    fireEvent.click(screen.getByRole("button", { name: "Generate image" }));

    const generated = await screen.findByAltText("Generated image 1");
    expect(generated).toHaveAttribute("src", "data:image/png;base64,aGVsbG8=");
    expect(fetchMock).toHaveBeenCalledWith("/api/images/generations", expect.objectContaining({ method: "POST" }));
  });

  it("sends reference image URLs from the image workbench", async () => {
    let imagePayload: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (path === "/api/accounts") {
        return Response.json([]);
      }
      if (path === "/api/images/generations" && init?.method === "POST") {
        imagePayload = JSON.parse(String(init.body));
        return Response.json({ data: [{ url: "https://cdn.test/reference-result.png" }] });
      }
      return Response.json({ error: { message: `unexpected path ${path}` } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("Master API Key"), { target: { value: "sk-local" } });
    fireEvent.click(screen.getByRole("button", { name: "进入控制台" }));

    await screen.findByRole("button", { name: "图片生成" });
    fireEvent.click(screen.getByRole("button", { name: "图片生成" }));

    fireEvent.change(screen.getByLabelText("Image prompt"), { target: { value: "保持人物姿态，改成赛博朋克风格" } });
    fireEvent.change(screen.getByLabelText("Reference image URLs (one per line)"), {
      target: { value: "https://assets.test/ref-a.png\nhttps://assets.test/ref-b.png" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate image" }));

    await screen.findByAltText("Generated image 1");
    expect(imagePayload).toMatchObject({
      prompt: "保持人物姿态，改成赛博朋克风格",
      images: ["https://assets.test/ref-a.png", "https://assets.test/ref-b.png"]
    });
  });

  it("sends chat messages with the selected model from the console", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer sk-local" });
      const path = String(url);
      if (path === "/api/accounts") {
        return Response.json([]);
      }
      if (path === "/api/registration/jobs" && init?.method === "GET") {
        return Response.json([]);
      }
      if (path === "/v1/models" && init?.method === "GET") {
        return Response.json({
          data: [
            { id: "openai.gpt-5.5" },
            { id: "claude.sonnet-4.6" }
          ]
        });
      }
      if (path === "/v1/chat/completions" && init?.method === "POST") {
        const payload = JSON.parse(String(init.body));
        expect(payload).toMatchObject({
          model: "claude.sonnet-4.6",
          stream: false,
          messages: [{ role: "user", content: "你好，介绍一下自己" }]
        });
        return Response.json({
          choices: [
            { message: { role: "assistant", content: "你好，我是 Navos 聊天助手。" } }
          ]
        });
      }
      return Response.json({ error: { message: `unexpected path ${path}` } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("Master API Key"), { target: { value: "sk-local" } });
    fireEvent.click(screen.getByRole("button", { name: "进入控制台" }));

    fireEvent.click(await screen.findByRole("button", { name: "聊天" }));
    await screen.findByRole("heading", { name: "聊天" });

    fireEvent.mouseDown(screen.getByLabelText("模型"));
    fireEvent.click(await screen.findByRole("option", { name: "claude.sonnet-4.6" }));
    fireEvent.change(screen.getByLabelText("输入消息"), {
      target: { value: "你好，介绍一下自己" }
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await screen.findByText("你好，我是 Navos 聊天助手。");
    expect(fetchMock).toHaveBeenCalledWith("/v1/models", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenCalledWith("/v1/chat/completions", expect.objectContaining({ method: "POST" }));
  });

  it("refreshes a row balance from the account pool", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer sk-local" });
      const path = String(url);
      if (path === "/api/accounts") {
        return Response.json([{
          uid: "u1",
          tokenPreview: "token-ab...",
          mailboxAddr: "a@mail.test",
          status: "active",
          balanceRemaining: 1000,
          balanceTotal: 1000,
          rateLimitedUntil: 0,
          createdAt: 0,
          lastUsedAt: 0,
          lastBalanceAt: 1000
        }]);
      }
      if (path === "/api/registration/jobs" && init?.method === "GET") {
        return Response.json([]);
      }
      if (path === "/api/accounts/u1/balance/refresh" && init?.method === "POST") {
        return Response.json({
          uid: "u1",
          tokenPreview: "token-ab...",
          mailboxAddr: "a@mail.test",
          status: "active",
          balanceRemaining: 1500,
          balanceTotal: 2000,
          rateLimitedUntil: 0,
          createdAt: 0,
          lastUsedAt: 0,
          lastBalanceAt: 2000
        });
      }
      return Response.json({ error: { message: "unexpected path" } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("Master API Key"), { target: { value: "sk-local" } });
    fireEvent.click(screen.getByRole("button", { name: "进入控制台" }));

    await screen.findByText("1000 / 1000");
    fireEvent.click(screen.getByRole("button", { name: "刷新 u1 余额" }));

    await screen.findByText("1500 / 2000");
    expect(fetchMock).toHaveBeenCalledWith("/api/accounts/u1/balance/refresh", expect.objectContaining({ method: "POST" }));
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

    fireEvent.change(screen.getByLabelText("任务描述"), {
      target: { value: "原创极简动画短片：白色机器人在桌面挥手。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "创建视频任务" }));

    await waitFor(() => {
      expect(screen.getByText("task_1")).toBeInTheDocument();
      expect(screen.getByText("succeeded")).toBeInTheDocument();
    });

    expect(screen.getByTitle("生成视频")).toHaveAttribute("src", "https://cdn.test/video.mp4");
    expect(screen.queryByText("archived")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/video/generations", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/video/generations/task_1", expect.objectContaining({ method: "GET" }));
  });

  it("sends omni reference URLs from the video console", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer sk-local" });
      const path = String(url);
      if (path === "/api/accounts") {
        return Response.json([]);
      }
      if (path === "/api/video/generations") {
        const payload = JSON.parse(String(init?.body));
        expect(payload).toMatchObject({
          mode: "omni_reference",
          generation_mode: "omni_reference",
          images: ["https://assets.test/ref.png"],
          imageRoles: ["reference_image"],
          videos: ["https://assets.test/motion.mp4"],
          videoRoles: ["reference_video"],
          audioRefs: ["https://assets.test/music.mp3"],
          audioRoles: ["reference_audio"],
          audio: true
        });
        expect(payload.prompt).toContain("keep the same character");
        return Response.json({
          code: 200,
          data: { task_id: "task_ref", status: "deducted" }
        });
      }
      if (path === "/api/video/generations/task_ref") {
        return Response.json({
          id: "task_ref",
          status: "succeeded",
          videoUrl: "https://cdn.test/ref-video.mp4",
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

    fireEvent.change(screen.getByLabelText("任务描述"), {
      target: { value: "keep the same character" }
    });
    fireEvent.change(screen.getByLabelText("图片参考 URL（每行一个）"), {
      target: { value: "https://assets.test/ref.png" }
    });
    fireEvent.change(screen.getByLabelText("视频参考 URL（每行一个）"), {
      target: { value: "https://assets.test/motion.mp4" }
    });
    fireEvent.change(screen.getByLabelText("音频参考 URL（每行一个）"), {
      target: { value: "https://assets.test/music.mp3" }
    });
    fireEvent.click(screen.getByRole("button", { name: "创建视频任务" }));

    await screen.findByText("task_ref");
    expect(fetchMock).toHaveBeenCalledWith("/api/video/generations", expect.objectContaining({ method: "POST" }));
  });



  it("submits long video prompts from the expanded editor", async () => {
    const longPrompt = [
      "第一段：赛博城市雨夜，白色机器人站在玻璃天桥上。",
      "第二段：镜头缓慢推进，霓虹反射在金属外壳上。",
      "第三段：保持电影感、低饱和、高细节，不要字幕。"
    ].join("\n");
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer sk-local" });
      const path = String(url);
      if (path === "/api/accounts") {
        return Response.json([]);
      }
      if (path === "/api/video/generations") {
        const payload = JSON.parse(String(init?.body));
        expect(payload.prompt).toBe(longPrompt);
        return Response.json({ code: 200, data: { task_id: "task_long", status: "deducted" } });
      }
      if (path === "/api/video/generations/task_long") {
        return Response.json({ id: "task_long", status: "succeeded", videoUrl: "https://cdn.test/long.mp4" });
      }
      return Response.json({ error: { message: "unexpected path" } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("Master API Key"), { target: { value: "sk-local" } });
    fireEvent.click(screen.getByRole("button", { name: "进入控制台" }));

    await screen.findByRole("button", { name: "视频生成" });
    fireEvent.click(screen.getByRole("button", { name: "视频生成" }));

    fireEvent.click(screen.getByRole("button", { name: "长文本编辑" }));
    fireEvent.change(screen.getByLabelText("长文本任务描述"), { target: { value: longPrompt } });
    fireEvent.click(screen.getByRole("button", { name: "完成编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "创建视频任务" }));

    await screen.findByText("task_long");
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
    expect(screen.getByLabelText("任务并发")).toHaveAttribute("aria-valuemax", "20");
    fireEvent.click(screen.getByRole("button", { name: "启动单个注册" }));

    await waitFor(() => {
      expect(screen.getByText("job-1")).toBeInTheDocument();
      expect(screen.getByText("succeeded")).toBeInTheDocument();
      expect(screen.getByText(/single registration completed/)).toBeInTheDocument();
    });
    expect(screen.getByText(/uid-full-1/)).toBeInTheDocument();
    expect(screen.getByText(/token-full-1/)).toBeInTheDocument();
  });

  it("distinguishes fill target from create count in account registration controls", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/accounts") return Response.json([]);
      if (path === "/api/registration/jobs" && init?.method === "GET") return Response.json([]);
      if (path === "/api/registration/jobs" && init?.method === "POST") return Response.json({ jobId: "job-create" });
      if (path === "/api/registration/jobs/job-create") {
        return Response.json({
          id: "job-create",
          mode: "create",
          state: "succeeded",
          count: 5,
          concurrency: 4,
          progress: { started: 5, completed: 5, failed: 0, total: 5 },
          logs: []
        });
      }
      return Response.json({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ConsoleShell
        accounts={[]}
        activePanel="accounts"
        apiKey="sk-local"
        onAccountsChange={vi.fn()}
        onPanelChange={vi.fn()}
        onRefreshAccounts={vi.fn(async () => [])}
        onSignOut={vi.fn()}
      />
    );

    fireEvent.change(await screen.findByLabelText("新增数量"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("任务并发"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "新增注册" }));

    const postCall = fetchMock.mock.calls.find(([path, init]) => path === "/api/registration/jobs" && init?.method === "POST");
    expect(JSON.parse(postCall?.[1]?.body as string)).toEqual({ mode: "create", count: 5, concurrency: 4 });
  });

  it("does not restore completed registration jobs when the account pool reloads", async () => {
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
      return Response.json({ error: { message: "unexpected path" } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("Master API Key"), { target: { value: "sk-local" } });
    fireEvent.click(screen.getByRole("button", { name: "进入控制台" }));

    await waitFor(() => {
      expect(screen.getAllByRole("heading", { name: "账号池" }).length).toBeGreaterThan(0);
    });

    await act(async () => {
      recentJobs.resolve(Response.json([{
        id: "job-done",
        mode: "fill",
        state: "succeeded",
        progress: { started: 1, completed: 1, failed: 0, total: 1 },
        logs: [{ at: 1000, level: "info", message: "old registration completed" }],
        results: { uid: "uid-old", token: "token-old" },
        createdAt: 900,
        finishedAt: 1000
      }]));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("暂无注册任务")).toBeInTheDocument();
    expect(screen.queryByText("job-done")).not.toBeInTheDocument();
    expect(screen.queryByText(/uid-old/)).not.toBeInTheDocument();
    expect(screen.queryByText(/token-old/)).not.toBeInTheDocument();
  });

  it("lets a completed registration job result be closed after a manual run", async () => {
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
        return Response.json({ jobId: "job-close" });
      }
      if (path === "/api/registration/jobs/job-close" && init?.method === "GET") {
        return Response.json({
          id: "job-close",
          mode: "single",
          state: "succeeded",
          progress: { started: 1, completed: 1, failed: 0, total: 1 },
          logs: [{ at: 1000, level: "info", message: "single registration completed" }],
          results: { uid: "uid-close", token: "token-close" },
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

    await screen.findByRole("button", { name: "启动单个注册" });
    fireEvent.click(screen.getByRole("button", { name: "启动单个注册" }));

    await screen.findByText("job-close");
    expect(screen.getByText(/uid-close/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭任务结果" }));

    expect(screen.getByText("暂无注册任务")).toBeInTheDocument();
    expect(screen.queryByText("job-close")).not.toBeInTheDocument();
    expect(screen.queryByText(/uid-close/)).not.toBeInTheDocument();
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

    const { container } = render(<App />);

    fireEvent.change(screen.getByLabelText("Master API Key"), { target: { value: "sk-local" } });
    fireEvent.click(screen.getByRole("button", { name: "进入控制台" }));

    await screen.findByRole("button", { name: "视频生成" });
    fireEvent.click(screen.getByRole("button", { name: "视频生成" }));

    expect(container.querySelector("select")).toBeNull();
    expect(screen.getByText("480P / 15秒")).toBeInTheDocument();
    expect(screen.getByText("720P / 10秒")).toBeInTheDocument();
    expect(screen.getByText("1080P / 5秒")).toBeInTheDocument();
    expect(screen.getByText("生成前会自动准备一个一次性账号")).toBeInTheDocument();
    expect(screen.getByText("账号池没有可用账号时会自动注册；每个账号只用于一个视频任务。")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByLabelText("分辨率"));
    fireEvent.click(await screen.findByRole("option", { name: "1080P" }));
    expect(screen.getByLabelText("时长")).toHaveAttribute("aria-valuemax", "5");
  });

  it("does not show COS config in the console", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer sk-local" });
      const path = String(url);
      if (path === "/api/accounts") {
        return Response.json([]);
      }
      return Response.json({ error: { message: "unexpected path" } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("Master API Key"), { target: { value: "sk-local" } });
    fireEvent.submit(screen.getByLabelText("Master API Key").closest("form") as HTMLFormElement);

    await screen.findByRole("button", { name: "YYDS配置" });
    expect(screen.queryByRole("button", { name: /COS/ })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/cos/config", expect.anything());
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
    fireEvent.click(screen.getByRole("button", { name: "Save YYDS config" }));

    await screen.findByText("Saved");
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
