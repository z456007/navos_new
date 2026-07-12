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

  it("prints periodic progress so long real runs do not look stalled", async () => {
    const source = await readFile("scripts/load/sub2api-chain-load-test.ts", "utf8");

    expect(source).toContain("LOAD_PROGRESS_INTERVAL_MS");
    expect(source).toContain("logProgress");
    expect(source).toContain("pending");
    expect(source).toContain("setInterval");
  });

  it("polls async media tasks through Sub2Api before counting them successful", async () => {
    const source = await readFile("scripts/load/sub2api-chain-load-test.ts", "utf8");

    expect(source).toContain("LOAD_POLL_MEDIA");
    expect(source).toContain("pollMediaTask");
    expect(source).toContain('path.startsWith("/videos/generations")');
    expect(source).toContain('path.startsWith("/images/generations")');
    expect(source).toContain('`/videos/${encodeURIComponent(taskId)}`');
    expect(source).toContain('`/images/generations/${encodeURIComponent(taskId)}`');
  });

  it("can route each real platform through its own Sub2Api API key while sharing the same base URL", async () => {
    const source = await readFile("scripts/load/sub2api-chain-load-test.ts", "utf8");
    const wrapper = await readFile("scripts/load/run-local-sub2api-chain.ps1", "utf8");

    for (const envName of [
      "SUB2API_CODEX_API_KEY",
      "SUB2API_CLAUDE_API_KEY",
      "SUB2API_DEEPSEEK_API_KEY",
      "SUB2API_IMAGE_API_KEY",
      "SUB2API_SEEDANCE_API_KEY"
    ]) {
      expect(source).toContain(envName);
    }
    expect(source).toContain("apiKey?: string");
    expect(source).toContain("const requestApiKey = apiKey ?? defaultApiKey");
    expect(source).toContain('SUB2API_DEEPSEEK_API_KEY ?? "sk-local-deepseek-zgm2003"');
    expect(wrapper).toContain('Sub2ApiDeepSeekApiKey = "sk-local-deepseek-zgm2003"');
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

  it("uses production-capable defaults for reference media and Seedance 2", async () => {
    const source = await readFile("scripts/load/sub2api-chain-load-test.ts", "utf8");

    expect(source).toContain('LOAD_VIDEO_MODEL ?? "doubao-seedance-2-0-260128"');
    expect(source).toContain("DEFAULT_REFERENCE_IMAGE_URL");
    expect(source).not.toContain("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=");
  });

  it("can narrow real diagnostics to specific media scenarios with faster Seedance settings", async () => {
    const source = await readFile("scripts/load/sub2api-chain-load-test.ts", "utf8");
    const wrapper = await readFile("scripts/load/run-local-sub2api-chain.ps1", "utf8");

    expect(source).toContain("LOAD_SCENARIOS");
    expect(source).toContain("selectedScenarioNames");
    expect(source).toContain("LOAD_VIDEO_RESOLUTION");
    expect(source).toContain("LOAD_VIDEO_DURATION_SECONDS");
    expect(source).toContain("LOAD_VIDEO_ASPECT_RATIO");
    expect(source).toContain("LOAD_IMAGE_SIZE");
    expect(source).toContain("videoResolution");
    expect(source).toContain("videoDurationSeconds");
    expect(source).toContain("videoAspectRatio");
    expect(source).toContain("imageSize");
    expect(source).toContain('resolution: videoResolution');
    expect(source).toContain('durationSeconds: videoDurationSeconds');
    expect(source).toContain('aspectRatio: videoAspectRatio');
    expect(source).toContain('generation_mode: "omni_reference"');
    expect(source).toContain('size: imageSize');
    expect(wrapper).toContain("[string]$Scenarios");
    expect(wrapper).toContain('[string]$VideoResolution = "480P"');
    expect(wrapper).toContain("[int]$VideoDurationSeconds = 5");
    expect(wrapper).toContain('[string]$VideoAspectRatio = "1:1"');
  });

  it("fake upstream covers video routes used by the all-channel runner", async () => {
    const source = await readFile("scripts/load/fake-navos-provider.ts", "utf8");

    expect(source).toContain("/api/video/generations");
    expect(source).toContain("/api/tasks/video/generations/:taskId");
    expect(source).toContain("videoUrl");
  });
});
