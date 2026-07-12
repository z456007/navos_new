import { describe, expect, it } from "vitest";
import { RegistrationJobService, type RegistrationQueuePort } from "../src/services/registration-job-service.js";
import type { RegistrationJobSnapshot, RegistrationJobState } from "../src/services/registration-job-types.js";

class FakeRegistrationQueue implements RegistrationQueuePort {
  readonly jobs = new Map<string, RegistrationJobSnapshot>();
  private nextId = 1;

  async add(
    data:
      | { mode: "single" }
      | { mode: "fill"; target: number; concurrency: number }
      | { mode: "create"; count: number; concurrency: number }
  ): Promise<string> {
    const id = `job-${this.nextId++}`;
    this.jobs.set(id, {
      id,
      mode: data.mode,
      state: "queued",
      target: data.mode === "fill" ? data.target : undefined,
      count: data.mode === "create" ? data.count : undefined,
      concurrency: data.mode === "fill" || data.mode === "create" ? data.concurrency : undefined,
      progress: {
        started: 0,
        completed: 0,
        failed: 0,
        total: data.mode === "fill" ? data.target : data.mode === "create" ? data.count : 1
      },
      logs: [],
      createdAt: 1000
    });
    return id;
  }

  async get(id: string): Promise<RegistrationJobSnapshot | undefined> {
    return this.jobs.get(id);
  }

  async list(): Promise<RegistrationJobSnapshot[]> {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  async cancel(id: string): Promise<RegistrationJobSnapshot | undefined> {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    const next: RegistrationJobSnapshot = { ...job, state: "canceled" as RegistrationJobState, finishedAt: 2000 };
    this.jobs.set(id, next);
    return next;
  }
}

describe("RegistrationJobService", () => {
  it("creates single and fill jobs with validation", async () => {
    const queue = new FakeRegistrationQueue();
    const service = new RegistrationJobService(queue, {
      defaultTarget: 8,
      defaultConcurrency: 2
    });

    const single = await service.createJob({ mode: "single" });
    const fill = await service.createJob({ mode: "fill" });

    expect(single).toEqual({ jobId: "job-1" });
    expect(fill).toEqual({ jobId: "job-2" });
    expect(await service.getJob("job-2")).toMatchObject({
      id: "job-2",
      mode: "fill",
      target: 8,
      concurrency: 2
    });
  });

  it("creates explicit create-count jobs without using fill defaults", async () => {
    const queue = new FakeRegistrationQueue();
    const service = new RegistrationJobService(queue, {
      defaultTarget: 8,
      defaultConcurrency: 2,
      maxConcurrency: 5000
    });

    const created = await service.createJob({ mode: "create", count: 10000, concurrency: 600 });

    expect(created).toEqual({ jobId: "job-1" });
    expect(await service.getJob("job-1")).toMatchObject({
      id: "job-1",
      mode: "create",
      count: 10000,
      concurrency: 600,
      progress: { started: 0, completed: 0, failed: 0, total: 10000 }
    });
  });

  it.each([
    ["missing count", { mode: "create", concurrency: 2 } as never, /count/],
    ["zero count", { mode: "create", count: 0, concurrency: 2 } as never, /count/],
    ["too-high count", { mode: "create", count: 100001, concurrency: 2 } as never, /count/],
    ["fractional count", { mode: "create", count: 1.5, concurrency: 2 } as never, /count/],
    ["string count", { mode: "create", count: "12", concurrency: 2 } as never, /count/]
  ])("rejects malformed create job input: %s", async (_caseName, input, message) => {
    const queue = new FakeRegistrationQueue();
    const service = new RegistrationJobService(queue, {
      defaultTarget: 8,
      defaultConcurrency: 2,
      maxConcurrency: 20
    });

    await expect(service.createJob(input)).rejects.toThrow(message);
    expect(queue.jobs).toHaveLength(0);
  });

  it.each([
    ["non-object input", null as never, /object/],
    ["missing mode", {} as never, /mode/],
    ["omitted mode with fill-like fields", { target: 8, concurrency: 2 } as never, /mode/],
    ["unknown mode", { mode: "bulk" } as never, /mode/],
    ["null mode", { mode: null } as never, /mode/],
    ["string target", { mode: "fill", target: "8", concurrency: 2 } as never, /target/],
    ["null target", { mode: "fill", target: null, concurrency: 2 } as never, /target/],
    ["string concurrency", { mode: "fill", target: 8, concurrency: "2" } as never, /concurrency/],
    ["null concurrency", { mode: "fill", target: 8, concurrency: null } as never, /concurrency/]
  ])("rejects malformed runtime input before applying fill defaults: %s", async (_caseName, input, message) => {
    const queue = new FakeRegistrationQueue();
    const service = new RegistrationJobService(queue, {
      defaultTarget: 8,
      defaultConcurrency: 2
    });

    await expect(service.createJob(input)).rejects.toThrow(message);
    expect(queue.jobs).toHaveLength(0);
  });

  it("rejects fill target and concurrency outside integer ranges", async () => {
    const service = new RegistrationJobService(new FakeRegistrationQueue(), {
      defaultTarget: 8,
      defaultConcurrency: 2
    });

    await expect(service.createJob({ mode: "fill", target: 0, concurrency: 2 })).rejects.toThrow(/target/);
    await expect(service.createJob({ mode: "fill", target: 100001, concurrency: 2 })).rejects.toThrow(/target/);
    await expect(service.createJob({ mode: "fill", target: 1.5, concurrency: 2 })).rejects.toThrow(/target/);
    await expect(service.createJob({ mode: "fill", target: 8, concurrency: 0 })).rejects.toThrow(/concurrency/);
    await expect(service.createJob({ mode: "fill", target: 8, concurrency: 5001 })).rejects.toThrow(/concurrency/);
    await expect(service.createJob({ mode: "fill", target: 8, concurrency: 1.5 })).rejects.toThrow(/concurrency/);
  });

  it("lists and cancels jobs", async () => {
    const service = new RegistrationJobService(new FakeRegistrationQueue(), {
      defaultTarget: 5,
      defaultConcurrency: 1
    });

    const created = await service.createJob({ mode: "single" });
    expect(await service.listJobs()).toHaveLength(1);

    const canceled = await service.cancelJob(created.jobId);
    expect(canceled).toMatchObject({ id: created.jobId, state: "canceled" });
    await expect(service.cancelJob("missing")).rejects.toThrow(/not found/);
  });
});
