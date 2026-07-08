// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../web/src/App";

describe("admin app gate", () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("requires a verified master api key before showing the console", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer sk-local" });
      return Response.json([]);
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

    expect(screen.getByTitle("生成视频")).toHaveAttribute("src", "https://cdn.test/video.mp4");
    expect(fetchMock).toHaveBeenCalledWith("/api/video/generations", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/video/generations/task_1", expect.objectContaining({ method: "GET" }));
  });
});
