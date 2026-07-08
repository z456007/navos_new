import { beforeEach, describe, expect, it, vi } from "vitest";
import { BullmqRegistrationQueue } from "../src/services/bullmq-registration-queue.js";
import { RegistrationQueueUnavailableError } from "../src/services/registration-job-service.js";
import type { RegistrationJobPayload } from "../src/services/registration-job-types.js";

type MockBullJob = {
  id?: string;
  data: RegistrationJobPayload;
  progress?: unknown;
  returnvalue?: unknown;
  failedReason?: string;
  timestamp?: number;
  processedOn?: number;
  finishedOn?: number;
  getState: ReturnType<typeof vi.fn>;
  remove?: ReturnType<typeof vi.fn>;
  updateData?: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => {
  const queueInstances: MockQueue[] = [];
  const redisInstances: MockRedis[] = [];

  class MockQueue {
    readonly name: string;
    readonly options: unknown;
    readonly add = vi.fn();
    readonly getJob = vi.fn();
    readonly getJobs = vi.fn();
    readonly getJobLogs = vi.fn(async () => ({ logs: [], count: 0 }));
    readonly close = vi.fn(async () => undefined);
    readonly on = vi.fn();

    constructor(name: string, options: unknown) {
      this.name = name;
      this.options = options;
      queueInstances.push(this);
    }
  }

  class MockRedis {
    readonly url: string;
    readonly options: unknown;
    readonly values = new Map<string, string>();
    readonly set = vi.fn(async (key: string, value: string) => {
      this.values.set(key, value);
      return "OK";
    });
    readonly get = vi.fn(async (key: string) => this.values.get(key) ?? null);
    readonly del = vi.fn(async (key: string) => {
      const existed = this.values.delete(key);
      return existed ? 1 : 0;
    });
    readonly quit = vi.fn(async () => "OK");
    readonly disconnect = vi.fn();
    readonly on = vi.fn();

    constructor(url: string, options: unknown) {
      this.url = url;
      this.options = options;
      redisInstances.push(this);
    }
  }

  return { MockQueue, MockRedis, queueInstances, redisInstances };
});

vi.mock("bullmq", () => ({ Queue: mocks.MockQueue }));
vi.mock("ioredis", () => ({ default: mocks.MockRedis, Redis: mocks.MockRedis }));

describe("BullmqRegistrationQueue", () => {
  const options = {
    redisUrl: "redis://localhost:6379/0",
    queuePrefix: "navos",
    removeOnComplete: 5,
    removeOnFail: 10
  };

  beforeEach(() => {
    mocks.queueInstances.length = 0;
    mocks.redisInstances.length = 0;
  });

  function buildQueue() {
    const adapter = new BullmqRegistrationQueue(options);
    const queue = mocks.queueInstances.at(-1)!;
    const redis = mocks.redisInstances.at(-1)!;
    return { adapter, queue, redis };
  }

  function makeJob(overrides: Partial<MockBullJob> = {}): MockBullJob {
    return {
      id: "job-1",
      data: { mode: "single" },
      progress: undefined,
      returnvalue: undefined,
      failedReason: undefined,
      timestamp: 1000,
      processedOn: undefined,
      finishedOn: undefined,
      getState: vi.fn(async () => "waiting"),
      remove: vi.fn(async () => undefined),
      updateData: vi.fn(async () => undefined),
      ...overrides
    };
  }

  it('add({ mode: "single" }) returns job id and calls Queue.add with remove options', async () => {
    const { adapter, queue, redis } = buildQueue();
    queue.add.mockResolvedValue({ id: "job-123" });

    await expect(adapter.add({ mode: "single" })).resolves.toBe("job-123");

    expect(redis.url).toBe(options.redisUrl);
    expect(redis.options).toEqual({
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      commandTimeout: 5000
    });
    expect(queue.name).toBe("registration");
    expect(queue.options).toEqual({ connection: redis, prefix: "navos" });
    expect(queue.add).toHaveBeenCalledWith("registration", { mode: "single" }, {
      removeOnComplete: 5,
      removeOnFail: 10
    });
  });

  it('get("job-1") maps a completed single job to snapshot state succeeded with results', async () => {
    const { adapter, queue } = buildQueue();
    const result = { success: true, uid: "uid-1" };
    const log = { at: 2200, level: "info", message: "registration completed" };
    queue.getJob.mockResolvedValue(makeJob({
      id: "job-1",
      data: { mode: "single" },
      progress: { started: 1, completed: 1, failed: 0, total: 1 },
      returnvalue: result,
      timestamp: 1111,
      processedOn: 2222,
      finishedOn: 3333,
      getState: vi.fn(async () => "completed")
    }));
    queue.getJobLogs.mockResolvedValue({ logs: [JSON.stringify(log)], count: 1 });

    await expect(adapter.get("job-1")).resolves.toEqual({
      id: "job-1",
      mode: "single",
      state: "succeeded",
      progress: { started: 1, completed: 1, failed: 0, total: 1 },
      logs: [log],
      results: result,
      createdAt: 1111,
      startedAt: 2222,
      finishedAt: 3333
    });
  });

  it("list() maps recent jobs from the expected BullMQ states", async () => {
    const { adapter, queue } = buildQueue();
    queue.getJobs.mockResolvedValue([
      makeJob({
        id: "job-2",
        data: { mode: "fill", target: 3, concurrency: 2 },
        progress: { started: 2, completed: 1, failed: 0, total: 3 },
        timestamp: 2000,
        processedOn: 2100,
        getState: vi.fn(async () => "active")
      })
    ]);

    await expect(adapter.list()).resolves.toEqual([
      {
        id: "job-2",
        mode: "fill",
        state: "running",
        target: 3,
        concurrency: 2,
        progress: { started: 2, completed: 1, failed: 0, total: 3 },
        logs: [],
        createdAt: 2000,
        startedAt: 2100
      }
    ]);
    expect(queue.getJobs).toHaveBeenCalledWith(["waiting", "active", "completed", "failed", "delayed"], 0, 49, false);
  });

  it("list() globally caps jobs by most recent timestamp and avoids BullMQ log reads", async () => {
    const { adapter, queue } = buildQueue();
    const progressLog = { at: 5400, level: "warn" as const, message: "waiting for account" };
    const jobs = Array.from({ length: 55 }, (_, index) => makeJob({
      id: `job-${index}`,
      data: { mode: "single" },
      progress: {
        started: index,
        completed: 0,
        failed: 0,
        total: 55,
        logs: index === 54 ? [progressLog] : []
      },
      timestamp: 1000 + index,
      getState: vi.fn(async () => index % 2 === 0 ? "waiting" : "completed")
    }));
    queue.getJobs.mockResolvedValue(jobs);
    queue.getJobLogs.mockResolvedValue({ logs: ["not-json-from-bullmq"], count: 1 });

    const snapshots = await adapter.list();

    expect(snapshots).toHaveLength(50);
    expect(snapshots.map((snapshot) => snapshot.id)).toEqual(
      Array.from({ length: 50 }, (_, index) => `job-${54 - index}`)
    );
    expect(snapshots[0]?.logs).toEqual([progressLog]);
    expect(queue.getJobLogs).not.toHaveBeenCalled();
  });

  it("list() skips missing BullMQ jobs and keeps remaining snapshots sorted", async () => {
    const { adapter, queue } = buildQueue();
    const olderJob = makeJob({
      id: "job-older",
      data: { mode: "single" },
      timestamp: 1000,
      getState: vi.fn(async () => "waiting")
    });
    const newerJob = makeJob({
      id: "job-newer",
      data: { mode: "single" },
      timestamp: 2000,
      getState: vi.fn(async () => "completed")
    });
    queue.getJobs.mockResolvedValue([olderJob, undefined, newerJob] as unknown as MockBullJob[]);

    const snapshots = await adapter.list();

    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((snapshot) => snapshot.id)).toEqual(["job-newer", "job-older"]);
    expect(snapshots.map((snapshot) => snapshot.state)).toEqual(["succeeded", "queued"]);
  });

  it("running job cancellation sets Redis key, marks job data, and returns running snapshot", async () => {
    const { adapter, queue, redis } = buildQueue();
    const job = makeJob({
      id: "job-2",
      data: { mode: "fill", target: 8, concurrency: 2 },
      progress: { started: 2, completed: 1, failed: 0, total: 8 },
      timestamp: 1000,
      processedOn: 1100,
      getState: vi.fn(async () => "active")
    });
    queue.getJob.mockResolvedValue(job);

    await expect(adapter.cancel("job-2")).resolves.toMatchObject({
      id: "job-2",
      mode: "fill",
      state: "running",
      target: 8,
      concurrency: 2,
      progress: { started: 2, completed: 1, failed: 0, total: 8 },
      createdAt: 1000,
      startedAt: 1100
    });
    expect(redis.set).toHaveBeenCalledWith("navos:registration:cancel:job-2", "1", "EX", 86400);
    expect(job.updateData).toHaveBeenCalledWith({ mode: "fill", target: 8, concurrency: 2, cancelRequested: true });
    expect(job.remove).not.toHaveBeenCalled();
  });

  it("running job cancellation still resolves if updateData rejects after Redis cancel key is set", async () => {
    const { adapter, queue, redis } = buildQueue();
    const job = makeJob({
      id: "job-update-race",
      data: { mode: "single" },
      progress: { started: 1, completed: 0, failed: 0, total: 1 },
      timestamp: 1000,
      processedOn: 1100,
      getState: vi.fn(async () => "active"),
      updateData: vi.fn(async () => {
        throw new Error("job finished before data update");
      })
    });
    queue.getJob.mockResolvedValue(job);

    await expect(adapter.cancel("job-update-race")).resolves.toMatchObject({
      id: "job-update-race",
      mode: "single",
      state: "running",
      progress: { started: 1, completed: 0, failed: 0, total: 1 },
      createdAt: 1000,
      startedAt: 1100
    });
    expect(redis.set).toHaveBeenCalledWith("navos:registration:cancel:job-update-race", "1", "EX", 86400);
    expect(job.updateData).toHaveBeenCalledWith({ mode: "single", cancelRequested: true });
  });

  it.each(["completed", "failed"] as const)(
    "cancel on %s job returns the current snapshot without recording a cancel request",
    async (state) => {
      const { adapter, queue, redis } = buildQueue();
      const job = makeJob({
        id: `job-${state}`,
        data: { mode: "single" },
        progress: { started: 1, completed: state === "completed" ? 1 : 0, failed: state === "failed" ? 1 : 0, total: 1 },
        returnvalue: state === "completed" ? { success: true, uid: "uid-1" } : undefined,
        failedReason: state === "failed" ? "registration failed" : undefined,
        timestamp: 1000,
        processedOn: 1100,
        finishedOn: 1200,
        getState: vi.fn(async () => state)
      });
      queue.getJob.mockResolvedValue(job);

      await expect(adapter.cancel(`job-${state}`)).resolves.toMatchObject({
        id: `job-${state}`,
        mode: "single",
        state: state === "completed" ? "succeeded" : "failed",
        progress: { started: 1, completed: state === "completed" ? 1 : 0, failed: state === "failed" ? 1 : 0, total: 1 },
        createdAt: 1000,
        startedAt: 1100,
        finishedAt: 1200
      });
      expect(redis.set).not.toHaveBeenCalled();
      expect(job.updateData).not.toHaveBeenCalled();
      expect(job.remove).not.toHaveBeenCalled();
    }
  );

  it("waiting job cancellation records a running cancel request if remove loses the lock race", async () => {
    const { adapter, queue, redis } = buildQueue();
    const job = makeJob({
      id: "job-race",
      data: { mode: "single" },
      progress: { started: 1, completed: 0, failed: 0, total: 1 },
      timestamp: 1000,
      processedOn: 1100,
      getState: vi.fn()
        .mockResolvedValueOnce("waiting")
        .mockResolvedValueOnce("active"),
      remove: vi.fn(async () => {
        throw new Error("job is locked");
      })
    });
    queue.getJob.mockResolvedValue(job);

    await expect(adapter.cancel("job-race")).resolves.toMatchObject({
      id: "job-race",
      mode: "single",
      state: "running",
      progress: { started: 1, completed: 0, failed: 0, total: 1 },
      createdAt: 1000,
      startedAt: 1100
    });
    expect(job.remove).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith("navos:registration:cancel:job-race", "1", "EX", 86400);
    expect(job.updateData).toHaveBeenCalledWith({ mode: "single", cancelRequested: true });
  });

  it('completed job with returnvalue { canceled: true } maps state canceled', async () => {
    const { adapter, queue } = buildQueue();
    queue.getJob.mockResolvedValue(makeJob({
      id: "job-3",
      returnvalue: { canceled: true },
      timestamp: 1000,
      finishedOn: 2000,
      getState: vi.fn(async () => "completed")
    }));

    await expect(adapter.get("job-3")).resolves.toMatchObject({
      id: "job-3",
      state: "canceled",
      results: { canceled: true },
      finishedAt: 2000
    });
  });

  it("queued/waiting job cancellation calls remove and returns canceled snapshot", async () => {
    const { adapter, queue, redis } = buildQueue();
    const job = makeJob({
      id: "job-4",
      timestamp: 1000,
      getState: vi.fn(async () => "waiting")
    });
    queue.getJob.mockResolvedValue(job);

    const snapshot = await adapter.cancel("job-4");

    expect(job.remove).toHaveBeenCalledTimes(1);
    expect(redis.set).not.toHaveBeenCalled();
    expect(snapshot).toMatchObject({
      id: "job-4",
      mode: "single",
      state: "canceled",
      progress: { started: 0, completed: 0, failed: 0, total: 0 },
      logs: [],
      createdAt: 1000
    });
    expect(snapshot?.finishedAt).toEqual(expect.any(Number));
  });

  it("isCancelRequested and clearCancelRequest use the expected key", async () => {
    const { adapter, redis } = buildQueue();
    const key = "navos:registration:cancel:job-5";

    await expect(adapter.isCancelRequested("job-5")).resolves.toBe(false);
    redis.values.set(key, "1");
    await expect(adapter.isCancelRequested("job-5")).resolves.toBe(true);
    await adapter.clearCancelRequest("job-5");

    expect(redis.get).toHaveBeenCalledWith(key);
    expect(redis.del).toHaveBeenCalledWith(key);
    await expect(adapter.isCancelRequested("job-5")).resolves.toBe(false);
  });

  it("add failure wraps as RegistrationQueueUnavailableError", async () => {
    const { adapter, queue } = buildQueue();
    queue.add.mockRejectedValue(new Error("redis down"));

    await expect(adapter.add({ mode: "single" })).rejects.toBeInstanceOf(RegistrationQueueUnavailableError);
  });

  it("add timeout wraps as RegistrationQueueUnavailableError", async () => {
    vi.useFakeTimers();
    try {
      const { adapter, queue } = buildQueue();
      queue.add.mockReturnValue(new Promise(() => undefined));

      const result = expect(adapter.add({ mode: "single" })).rejects.toBeInstanceOf(RegistrationQueueUnavailableError);
      await vi.advanceTimersByTimeAsync(2000);

      await result;
    } finally {
      vi.useRealTimers();
    }
  });

  it("get failure wraps as RegistrationQueueUnavailableError", async () => {
    const { adapter, queue } = buildQueue();
    queue.getJob.mockRejectedValue(new Error("redis down"));

    await expect(adapter.get("job-1")).rejects.toBeInstanceOf(RegistrationQueueUnavailableError);
  });

  it("list failure wraps as RegistrationQueueUnavailableError", async () => {
    const { adapter, queue } = buildQueue();
    queue.getJobs.mockRejectedValue(new Error("redis down"));

    await expect(adapter.list()).rejects.toBeInstanceOf(RegistrationQueueUnavailableError);
  });

  it("cancel failure wraps as RegistrationQueueUnavailableError", async () => {
    const { adapter, queue } = buildQueue();
    queue.getJob.mockRejectedValue(new Error("redis down"));

    await expect(adapter.cancel("job-1")).rejects.toBeInstanceOf(RegistrationQueueUnavailableError);
  });

  it("cancel Redis write failure wraps as RegistrationQueueUnavailableError", async () => {
    const { adapter, queue, redis } = buildQueue();
    queue.getJob.mockResolvedValue(makeJob({
      id: "job-redis-failure",
      getState: vi.fn(async () => "active")
    }));
    redis.set.mockRejectedValue(new Error("redis down"));

    await expect(adapter.cancel("job-redis-failure")).rejects.toBeInstanceOf(RegistrationQueueUnavailableError);
  });

  it("close closes the queue and Redis connection", async () => {
    const { adapter, queue, redis } = buildQueue();

    await adapter.close();

    expect(queue.close).toHaveBeenCalledTimes(1);
    expect(redis.quit).toHaveBeenCalledTimes(1);
    expect(redis.disconnect).not.toHaveBeenCalled();
  });

  it("close still releases Redis when queue close rejects", async () => {
    const { adapter, queue, redis } = buildQueue();
    queue.close.mockRejectedValue(new Error("queue close failed"));

    await expect(adapter.close()).rejects.toThrow("queue close failed");

    expect(redis.quit).toHaveBeenCalledTimes(1);
    expect(redis.disconnect).not.toHaveBeenCalled();
  });
});
