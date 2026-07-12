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
    expect(source).toContain("/videos/generations");
    expect(source).not.toContain('path: "/video/generations"');
  });

  it("defaults to the local Sub2Api frontend proxy port used by the operator", async () => {
    const runner = await readFile("scripts/load/sub2api-chain-load-test.ts", "utf8");
    const wrapper = await readFile("scripts/load/run-local-sub2api-chain.ps1", "utf8");

    expect(runner).toContain('SUB2API_BASE_URL ?? "http://127.0.0.1:3000/v1"');
    expect(wrapper).toContain('Sub2ApiBaseUrl = "http://127.0.0.1:3000/v1"');
  });

  it("records error categories and failure samples for production diagnostics", async () => {
    const source = await readFile("scripts/load/sub2api-chain-load-test.ts", "utf8");

    expect(source).toContain("errorSummary");
    expect(source).toContain("failureSamples");
    expect(source).toContain("quota_or_depleted");
    expect(source).toContain("account_action");
    expect(source).toContain("classifyFailureBody");
  });

  it("has an exact production 100 plan for codex claude deepseek image and seedance", async () => {
    const source = await readFile("scripts/load/sub2api-chain-load-test.ts", "utf8");

    expect(source).toContain("LOAD_PRODUCTION_100");
    for (const scenario of [
      "codex-chat",
      "claude-code-vision-chat",
      "deepseek-chat",
      "gpt-image-2-mixed",
      "seedance-reference-video"
    ]) {
      expect(source).toContain(`name: \`${scenario}-`);
    }
    expect(source).toContain("/responses");
    expect(source).toContain("claude-sonnet-4-6");
    expect(source).toContain("tool_result");
    expect(source).toContain("image_url");
    expect(source).toContain("runScenariosInParallel");
    expect(source).toContain("LOAD_SCENARIO_PARALLEL");
    expect(source).toContain('path: "/videos/generations"');
  });

  it("fake upstream covers video routes used by the all-channel runner", async () => {
    const source = await readFile("scripts/load/fake-navos-provider.ts", "utf8");

    expect(source).toContain("/api/video/generations");
    expect(source).toContain("/api/tasks/video/generations/:taskId");
    expect(source).toContain("videoUrl");
  });
});
