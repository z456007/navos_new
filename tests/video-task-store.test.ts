import { describe, expect, it } from "vitest";
import { parseVideoTaskRawJson } from "../src/store/video-task-store.js";

describe("video task store raw json parsing", () => {
  it("keeps MySQL JSON values that are already parsed objects", () => {
    const raw = { task_id: "task_1", status: "running" };

    expect(parseVideoTaskRawJson(raw)).toEqual(raw);
  });

  it("parses MySQL JSON values returned as strings", () => {
    expect(parseVideoTaskRawJson('{"task_id":"task_1","status":"success"}')).toEqual({
      task_id: "task_1",
      status: "success"
    });
  });

  it("treats null raw json as missing", () => {
    expect(parseVideoTaskRawJson(null)).toBeUndefined();
  });
});
