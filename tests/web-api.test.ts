import { afterEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

describe("web apiRequest", () => {
  it("uses an explicit backend base URL when configured", async () => {
    const env = import.meta.env as Record<string, string | undefined>;
    const previousBaseUrl = env.VITE_API_BASE_URL;
    env.VITE_API_BASE_URL = "http://api.test/";
    vi.resetModules();
    const { apiRequest } = await import("../web/src/api.ts?explicit-base");
    env.VITE_API_BASE_URL = previousBaseUrl;
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("sk-test", "/api/accounts", { method: "GET" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/accounts",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("defaults development mode API calls to the local backend port", async () => {
    const env = import.meta.env as Record<string, string | undefined>;
    const previousBaseUrl = env.VITE_API_BASE_URL;
    const previousMode = env.MODE;
    env.VITE_API_BASE_URL = "";
    env.MODE = "development";
    vi.resetModules();
    const { apiRequest } = await import("../web/src/api.ts?dev-base");
    env.VITE_API_BASE_URL = previousBaseUrl;
    env.MODE = previousMode;
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("sk-test", "/api/accounts", { method: "GET" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:18888/api/accounts",
      expect.objectContaining({ method: "GET" })
    );
  });
});
