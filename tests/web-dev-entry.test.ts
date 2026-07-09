import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("web dev entry", () => {
  it("serves the admin app from Vite dev root", () => {
    const indexPath = resolve(process.cwd(), "index.html");

    expect(existsSync(indexPath)).toBe(true);

    const html = readFileSync(indexPath, "utf8");
    expect(html).toContain('id="root"');
    expect(html).toContain('type="module"');
    expect(html).toContain('/web/src/main.tsx');
  });

  it("opens the admin app without proxying backend APIs in dev", () => {
    const configPath = resolve(process.cwd(), "vite.config.ts");
    const config = readFileSync(configPath, "utf8");

    expect(config).toContain("open: true");
    expect(config).toContain("port: 15173");
    expect(config).not.toContain("proxy:");
    expect(config).not.toContain('target: "http://127.0.0.1:18888"');
  });
});
