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

  it("records error categories and failure samples for production diagnostics", async () => {
    const source = await readFile("scripts/load/sub2api-chain-load-test.ts", "utf8");

    expect(source).toContain("errorSummary");
    expect(source).toContain("failureSamples");
    expect(source).toContain("quota_or_depleted");
    expect(source).toContain("account_action");
    expect(source).toContain("classifyFailureBody");
  });

  it("fake upstream covers video routes used by the all-channel runner", async () => {
    const source = await readFile("scripts/load/fake-navos-provider.ts", "utf8");

    expect(source).toContain("/api/video/generations");
    expect(source).toContain("/api/tasks/video/generations/:taskId");
    expect(source).toContain("videoUrl");
  });
});
