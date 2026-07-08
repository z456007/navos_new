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
});
