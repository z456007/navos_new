import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("sub2api chain load script", () => {
  it("covers all public channels in one mixed real-account run", async () => {
    const source = await readFile("scripts/load/sub2api-chain-load-test.ts", "utf8");

    for (const scenario of [
      "chat",
      "long-chat",
      "vision-chat",
      "deepseek-chat",
      "image-t2i",
      "image-reference",
      "seedance-t2v",
      "seedance-reference",
      "mixed-all"
    ]) {
      expect(source).toContain(`name: \`${scenario}-`);
    }
    expect(source).toContain("LOAD_MIXED_ALL");
    expect(source).toContain("/chat/completions");
    expect(source).toContain("/images/generations");
    expect(source).toContain("/video/generations");
  });
});
