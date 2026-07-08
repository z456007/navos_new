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

    fireEvent.change(screen.getByLabelText("Master API Key"), { target: { value: "sk-local" } });
    fireEvent.click(screen.getByRole("button", { name: "进入控制台" }));

    await waitFor(() => {
      expect(screen.getAllByRole("heading", { name: "账号池" }).length).toBeGreaterThan(0);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/accounts", expect.objectContaining({ method: "GET" }));
    expect(localStorage.getItem("navos.admin.apiKey")).toBe("sk-local");
  });
});
