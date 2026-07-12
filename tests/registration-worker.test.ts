import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RegistrationResult, RegistrationService, RegistrationStats } from "../src/services/registration-service.js";
import type {
  RegistrationJobLog,
  RegistrationJobPayload,
  RegistrationJobProgress
} from "../src/services/registration-job-types.js";
import { createRegistrationWorker, processRegistrationJob } from "../src/services/registration-worker.js";

type ProgressWithLogs = RegistrationJobProgress & { logs: RegistrationJobLog[] };
type TestJob = Parameters<typeof processRegistrationJob>[0];
type MockRegistrationService = Pick<RegistrationService, "registerOne" | "getStats">;

const bullmqMocks = vi.hoisted(() => {
  type Processor = (job: unknown) => Promise<unknown>;

  class MockWorker {
    readonly name: string;
    readonly processor: Processor;
    readonly options: unknown;

    constructor(name: string, processor: Processor, options: unknown) {
      this.name = name;
      this.processor = processor;
      this.options = options;
      bullmqMocks.workerInstances.push(this);
    }
  }

  return {
    MockWorker,
    workerInstances: [] as MockWorker[]
  };
});

vi.mock("bullmq", () => ({ Worker: bullmqMocks.MockWorker }));

describe("processRegistrationJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeRegistrationService(
    overrides: Partial<MockRegistrationService> = {}
  ): RegistrationService {
    const service: MockRegistrationService = {
      registerOne: vi.fn(async () => ({ success: true })),
      getStats: vi.fn(async () => stats({ activeCount: 0 })),
      ...overrides
    };
    return service as unknown as RegistrationService;
  }

  function makeJob(data: RegistrationJobPayload, id: string | number = "job-1"): TestJob {
    return {
      id,
      data,
      updateProgress: vi.fn(async () => undefined)
    };
  }

  function stats(overrides: Partial<RegistrationStats>): RegistrationStats {
    return {
      poolSize: 0,
      activeCount: 0,
      depletedCount: 0,
      disabledCount: 0,
      ...overrides
    };
  }

  function lastProgress(job: TestJob): ProgressWithLogs {
    const calls = vi.mocked(job.updateProgress).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls.at(-1)?.[0] as ProgressWithLogs;
  }

  function success(id: number): RegistrationResult {
    return { success: true, uid: `uid-${id}`, token: `token-${id}` };
  }

  function failure(message: string): RegistrationResult {
    return { success: false, error: message };
  }

  function deferredResult(result: RegistrationResult): {
    promise: Promise<RegistrationResult>;
    resolve: () => void;
  } {
    let resolve!: () => void;
    const promise = new Promise<RegistrationResult>((done) => {
      resolve = () => done(result);
    });
    return { promise, resolve };
  }

  function deferredVoid(): {
    promise: Promise<void>;
    resolve: () => void;
  } {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = () => done();
    });
    return { promise, resolve };
  }

  it("processes one single registration job", async () => {
    const result = success(1);
    const registrationService = makeRegistrationService({
      registerOne: vi.fn(async () => result)
    });
    const job = makeJob({ mode: "single" });

    await expect(processRegistrationJob(job, registrationService)).resolves.toBe(result);

    expect(registrationService.registerOne).toHaveBeenCalledTimes(1);
    expect(lastProgress(job)).toMatchObject({
      started: 1,
      completed: 1,
      failed: 0,
      total: 1
    });
  });

  it("resolves single success when clearing a cancel request fails", async () => {
    const result = success(1);
    const registrationService = makeRegistrationService({
      registerOne: vi.fn(async () => result)
    });
    const clearCancelRequest = vi.fn(async () => {
      throw new Error("redis unavailable");
    });
    const job = makeJob({ mode: "single" });

    await expect(
      processRegistrationJob(job, registrationService, { clearCancelRequest })
    ).resolves.toBe(result);

    expect(clearCancelRequest).toHaveBeenCalledWith("job-1");
    expect(lastProgress(job)).toMatchObject({
      started: 1,
      completed: 1,
      failed: 0,
      total: 1
    });
  });

  it("updates failed progress and throws when single registration fails", async () => {
    const registrationService = makeRegistrationService({
      registerOne: vi.fn(async () => failure("mailbox unavailable"))
    });
    const clearCancelRequest = vi.fn(async () => undefined);
    const job = makeJob({ mode: "single" });

    await expect(
      processRegistrationJob(job, registrationService, { clearCancelRequest })
    ).rejects.toThrow("mailbox unavailable");

    expect(registrationService.registerOne).toHaveBeenCalledTimes(1);
    expect(clearCancelRequest).toHaveBeenCalledWith("job-1");
    expect(lastProgress(job)).toMatchObject({
      started: 1,
      completed: 0,
      failed: 1,
      total: 1
    });
  });

  it("fills needed accounts in batches respecting concurrency", async () => {
    const firstAttempt = deferredResult(success(1));
    const secondAttempt = deferredResult(failure("verification failed"));
    const thirdAttempt = deferredResult(success(2));
    const attemptQueue = [
      firstAttempt,
      secondAttempt,
      thirdAttempt
    ];
    const expectedResults = [
      success(1),
      failure("verification failed"),
      success(2)
    ];
    let active = 0;
    let maxActive = 0;
    const registrationService = makeRegistrationService({
      getStats: vi.fn(async () => stats({ activeCount: 0 })),
      registerOne: vi.fn(() => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        const attempt = attemptQueue.shift();
        if (!attempt) {
          throw new Error("unexpected registration attempt");
        }
        return attempt.promise.finally(() => {
          active -= 1;
        });
      })
    });
    const job = makeJob({ mode: "fill", target: 3, concurrency: 2 });

    const processing = processRegistrationJob(job, registrationService);

    await vi.waitFor(() => expect(registrationService.registerOne).toHaveBeenCalledTimes(2));
    firstAttempt.resolve();
    secondAttempt.resolve();
    await vi.waitFor(() => expect(registrationService.registerOne).toHaveBeenCalledTimes(3));
    thirdAttempt.resolve();

    await expect(processing).resolves.toMatchObject({
      target: 3,
      started: 3,
      completed: 2,
      failed: 1,
      results: expectedResults
    });
    expect(registrationService.getStats).toHaveBeenCalledTimes(1);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(lastProgress(job)).toMatchObject({
      started: 3,
      completed: 2,
      failed: 1,
      total: 3
    });
  });

  it("uses requested fill concurrency without an extra worker cap", async () => {
    const attempts = [
      deferredResult(success(1)),
      deferredResult(success(2)),
      deferredResult(success(3)),
      deferredResult(success(4)),
      deferredResult(success(5))
    ];
    const attemptQueue = [...attempts];
    let active = 0;
    let maxActive = 0;
    const registrationService = makeRegistrationService({
      getStats: vi.fn(async () => stats({ activeCount: 0 })),
      registerOne: vi.fn(() => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        const attempt = attemptQueue.shift();
        if (!attempt) {
          throw new Error("unexpected registration attempt");
        }
        return attempt.promise.finally(() => {
          active -= 1;
        });
      })
    });
    const job = makeJob({ mode: "fill", target: 5, concurrency: 10 });

    const processing = processRegistrationJob(job, registrationService);

    await vi.waitFor(() => expect(registrationService.registerOne).toHaveBeenCalledTimes(5));
    for (const attempt of attempts) {
      attempt.resolve();
    }

    await expect(processing).resolves.toMatchObject({
      target: 5,
      started: 5,
      completed: 5,
      failed: 0
    });
    expect(maxActive).toBe(5);
  });

  it("updates fill progress after a batch starts before registrations resolve", async () => {
    const firstAttempt = deferredResult(success(1));
    const secondAttempt = deferredResult(success(2));
    const registrationService = makeRegistrationService({
      getStats: vi.fn(async () => stats({ activeCount: 0 })),
      registerOne: vi.fn()
        .mockReturnValueOnce(firstAttempt.promise)
        .mockReturnValueOnce(secondAttempt.promise)
    });
    const job = makeJob({ mode: "fill", target: 2, concurrency: 2 });

    const processing = processRegistrationJob(job, registrationService);

    await vi.waitFor(() => expect(registrationService.registerOne).toHaveBeenCalledTimes(2));
    expect(lastProgress(job)).toMatchObject({
      started: 2,
      completed: 0,
      failed: 0,
      total: 2
    });

    firstAttempt.resolve();
    secondAttempt.resolve();
    await expect(processing).resolves.toMatchObject({
      started: 2,
      completed: 2,
      failed: 0
    });
  });

  it("does not start fill registrations until batch-start progress update resolves", async () => {
    const batchStartedProgress = deferredVoid();
    const expectedResults = [success(1), success(2)];
    const registrationService = makeRegistrationService({
      getStats: vi.fn(async () => stats({ activeCount: 0 })),
      registerOne: vi.fn()
        .mockResolvedValueOnce(expectedResults[0])
        .mockResolvedValueOnce(expectedResults[1])
    });
    const job = makeJob({ mode: "fill", target: 2, concurrency: 2 });
    job.updateProgress = vi.fn(async (nextProgress) => {
      const progress = nextProgress as ProgressWithLogs;
      if (progress.logs.at(-1)?.message === "fill registration batch started") {
        await batchStartedProgress.promise;
      }
    });

    const processing = processRegistrationJob(job, registrationService);

    await vi.waitFor(() => {
      expect(job.updateProgress).toHaveBeenCalledTimes(2);
      expect(lastProgress(job).logs.at(-1)).toMatchObject({
        level: "info",
        message: "fill registration batch started"
      });
    });
    const registrationCallsBeforeBatchProgressResolved = vi.mocked(registrationService.registerOne).mock.calls.length;

    batchStartedProgress.resolve();
    await vi.waitFor(() => expect(registrationService.registerOne).toHaveBeenCalledTimes(2));

    await expect(processing).resolves.toMatchObject({
      target: 2,
      started: 2,
      completed: 2,
      failed: 0,
      results: expectedResults
    });
    expect(registrationCallsBeforeBatchProgressResolved).toBe(0);
  });

  it("starts concurrent fill jobs without waiting for another fill to finish", async () => {
    const firstAttempt = deferredResult(success(1));
    const secondAttempt = deferredResult(success(2));
    const thirdAttempt = deferredResult(success(3));
    const fourthAttempt = deferredResult(success(4));
    const attemptQueue = [firstAttempt, secondAttempt, thirdAttempt, fourthAttempt];
    const registrationService = makeRegistrationService({
      getStats: vi.fn(async () => stats({ activeCount: 0 })),
      registerOne: vi.fn(() => {
        const attempt = attemptQueue.shift();
        if (!attempt) {
          throw new Error("unexpected registration attempt");
        }
        return attempt.promise;
      })
    });
    const firstJob = makeJob({ mode: "fill", target: 2, concurrency: 2 }, "fill-1");
    const secondJob = makeJob({ mode: "fill", target: 2, concurrency: 2 }, "fill-2");

    const firstProcessing = processRegistrationJob(firstJob, registrationService);
    const secondProcessing = processRegistrationJob(secondJob, registrationService);

    await vi.waitFor(() => expect(registrationService.getStats).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(registrationService.registerOne).toHaveBeenCalledTimes(4));
    expect(lastProgress(firstJob)).toMatchObject({
      started: 2,
      completed: 0,
      failed: 0,
      total: 2
    });
    expect(lastProgress(secondJob)).toMatchObject({
      started: 2,
      completed: 0,
      failed: 0,
      total: 2
    });

    firstAttempt.resolve();
    secondAttempt.resolve();
    thirdAttempt.resolve();
    fourthAttempt.resolve();

    await expect(firstProcessing).resolves.toMatchObject({
      target: 2,
      started: 2,
      completed: 2,
      failed: 0,
      results: [success(1), success(2)]
    });
    await expect(secondProcessing).resolves.toMatchObject({
      target: 2,
      started: 2,
      completed: 2,
      failed: 0,
      results: [success(3), success(4)]
    });
  });

  it("cancels a concurrent fill while another fill is still registering", async () => {
    const firstAttempt = deferredResult(success(1));
    const secondAttempt = deferredResult(success(2));
    const attemptQueue = [firstAttempt, secondAttempt];
    const registrationService = makeRegistrationService({
      getStats: vi.fn(async () => stats({ activeCount: 0 })),
      registerOne: vi.fn(() => {
        const attempt = attemptQueue.shift();
        if (!attempt) {
          throw new Error("unexpected registration attempt");
        }
        return attempt.promise;
      })
    });
    let secondJobCancellationChecks = 0;
    const isCancelRequested = vi.fn(async (jobId: string) => {
      if (jobId !== "fill-2") {
        return false;
      }
      secondJobCancellationChecks += 1;
      return secondJobCancellationChecks > 1;
    });
    const clearCancelRequest = vi.fn(async () => undefined);
    const firstJob = makeJob({ mode: "fill", target: 2, concurrency: 2 }, "fill-1");
    const secondJob = makeJob({ mode: "fill", target: 2, concurrency: 2 }, "fill-2");

    const firstProcessing = processRegistrationJob(firstJob, registrationService, {
      isCancelRequested,
      clearCancelRequest
    });
    const secondProcessing = processRegistrationJob(secondJob, registrationService, {
      isCancelRequested,
      clearCancelRequest
    });

    await vi.waitFor(() => expect(registrationService.registerOne).toHaveBeenCalledTimes(2));
    await expect(secondProcessing).resolves.toEqual({
      canceled: true,
      mode: "fill",
      target: 2,
      concurrency: 2,
      activeBefore: 0,
      planned: 2,
      started: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      results: []
    });

    expect(clearCancelRequest).toHaveBeenCalledWith("fill-2");
    expect(registrationService.registerOne).toHaveBeenCalledTimes(2);
    expect(lastProgress(secondJob).logs.at(-1)).toMatchObject({
      level: "warn",
      message: expect.stringContaining("canceled")
    });

    firstAttempt.resolve();
    secondAttempt.resolve();

    await expect(firstProcessing).resolves.toMatchObject({
      target: 2,
      started: 2,
      completed: 2,
      failed: 0,
      results: [success(1), success(2)]
    });
  });

  it.each([
    ["NaN target", { mode: "fill", target: Number.NaN, concurrency: 1 }, /target/],
    ["fractional target", { mode: "fill", target: 1.5, concurrency: 1 }, /target/],
    ["infinite target", { mode: "fill", target: Number.POSITIVE_INFINITY, concurrency: 1 }, /target/],
    ["zero target", { mode: "fill", target: 0, concurrency: 1 }, /target/],
    ["too-high target", { mode: "fill", target: 100001, concurrency: 1 }, /target/],
    ["NaN concurrency", { mode: "fill", target: 2, concurrency: Number.NaN }, /concurrency/],
    ["fractional concurrency", { mode: "fill", target: 2, concurrency: 1.5 }, /concurrency/],
    [
      "infinite concurrency",
      { mode: "fill", target: 2, concurrency: Number.POSITIVE_INFINITY },
      /concurrency/
    ],
    ["zero concurrency", { mode: "fill", target: 2, concurrency: 0 }, /concurrency/],
    ["too-high concurrency", { mode: "fill", target: 2, concurrency: 5001 }, /concurrency/]
  ])("rejects malformed fill payload before stats/progress/registering: %s", async (_caseName, payload, message) => {
    const registrationService = makeRegistrationService({
      getStats: vi.fn(async () => stats({ activeCount: 0 }))
    });
    const clearCancelRequest = vi.fn(async () => undefined);
    const job = makeJob(payload as RegistrationJobPayload);
    job.updateProgress = vi.fn(async () => {
      throw new Error("progress should not start for malformed fill payload");
    });

    await expect(
      processRegistrationJob(job, registrationService, { clearCancelRequest })
    ).rejects.toThrow(message);

    expect(clearCancelRequest).toHaveBeenCalledWith("job-1");
    expect(registrationService.getStats).not.toHaveBeenCalled();
    expect(registrationService.registerOne).not.toHaveBeenCalled();
    expect(job.updateProgress).not.toHaveBeenCalled();
  });

  it("clears fill cancel request when getStats throws without masking the original error", async () => {
    const registrationService = makeRegistrationService({
      getStats: vi.fn(async () => {
        throw new Error("stats unavailable");
      })
    });
    const clearCancelRequest = vi.fn(async () => {
      throw new Error("redis unavailable");
    });
    const job = makeJob({ mode: "fill", target: 2, concurrency: 1 });

    await expect(
      processRegistrationJob(job, registrationService, { clearCancelRequest })
    ).rejects.toThrow("stats unavailable");

    expect(clearCancelRequest).toHaveBeenCalledWith("job-1");
    expect(registrationService.registerOne).not.toHaveBeenCalled();
    expect(job.updateProgress).not.toHaveBeenCalled();
  });

  it("rejects malformed fill concurrency without registering", async () => {
    const registrationService = makeRegistrationService({
      getStats: vi.fn(async () => stats({ activeCount: 0 }))
    });
    const clearCancelRequest = vi.fn(async () => undefined);
    const job = makeJob({ mode: "fill", target: 2, concurrency: 0 });

    await expect(
      processRegistrationJob(job, registrationService, { clearCancelRequest })
    ).rejects.toThrow(
      "bulk registration concurrency must be an integer from 1 to 5000"
    );

    expect(clearCancelRequest).toHaveBeenCalledWith("job-1");
    expect(registrationService.getStats).not.toHaveBeenCalled();
    expect(registrationService.registerOne).not.toHaveBeenCalled();
  });

  it.each([
    ["NaN count", { mode: "create", count: Number.NaN, concurrency: 1 }, /create registration count/],
    ["fractional count", { mode: "create", count: 1.5, concurrency: 1 }, /create registration count/],
    [
      "infinite count",
      { mode: "create", count: Number.POSITIVE_INFINITY, concurrency: 1 },
      /create registration count/
    ],
    ["zero count", { mode: "create", count: 0, concurrency: 1 }, /create registration count/],
    ["too-high count", { mode: "create", count: 100001, concurrency: 1 }, /create registration count/],
    ["NaN concurrency", { mode: "create", count: 2, concurrency: Number.NaN }, /bulk registration concurrency/],
    ["fractional concurrency", { mode: "create", count: 2, concurrency: 1.5 }, /bulk registration concurrency/],
    [
      "infinite concurrency",
      { mode: "create", count: 2, concurrency: Number.POSITIVE_INFINITY },
      /bulk registration concurrency/
    ],
    ["zero concurrency", { mode: "create", count: 2, concurrency: 0 }, /bulk registration concurrency/],
    ["too-high concurrency", { mode: "create", count: 2, concurrency: 5001 }, /bulk registration concurrency/]
  ])("rejects malformed create payload before stats/progress/registering: %s", async (_caseName, payload, message) => {
    const registrationService = makeRegistrationService({
      getStats: vi.fn(async () => stats({ activeCount: 0 }))
    });
    const clearCancelRequest = vi.fn(async () => undefined);
    const job = makeJob(payload as RegistrationJobPayload);
    job.updateProgress = vi.fn(async () => {
      throw new Error("progress should not start for malformed create payload");
    });

    await expect(
      processRegistrationJob(job, registrationService, { clearCancelRequest })
    ).rejects.toThrow(message);

    expect(clearCancelRequest).toHaveBeenCalledWith("job-1");
    expect(registrationService.getStats).not.toHaveBeenCalled();
    expect(registrationService.registerOne).not.toHaveBeenCalled();
    expect(job.updateProgress).not.toHaveBeenCalled();
  });

  it("reduces fill attempts by the current active account count", async () => {
    const registrationService = makeRegistrationService({
      getStats: vi.fn(async () => stats({ activeCount: 3 })),
      registerOne: vi.fn()
        .mockResolvedValueOnce(success(1))
        .mockResolvedValueOnce(success(2))
    });
    const job = makeJob({ mode: "fill", target: 5, concurrency: 2 });

    await expect(processRegistrationJob(job, registrationService)).resolves.toMatchObject({
      target: 5,
      started: 2,
      completed: 2,
      failed: 0,
      results: [success(1), success(2)]
    });

    expect(registrationService.getStats).toHaveBeenCalledTimes(1);
    expect(registrationService.registerOne).toHaveBeenCalledTimes(2);
    expect(lastProgress(job)).toMatchObject({
      started: 2,
      completed: 2,
      failed: 0,
      total: 2
    });
  });

  it("reports fill planned attempts as target minus active count", async () => {
    const registrationService = makeRegistrationService({
      getStats: vi.fn(async () => stats({ activeCount: 97 })),
      registerOne: vi.fn(async () => success(1))
    });
    const job = makeJob({ mode: "fill", target: 100, concurrency: 6 });

    const result = await processRegistrationJob(job, registrationService);

    expect(result).toMatchObject({
      mode: "fill",
      target: 100,
      activeBefore: 97,
      planned: 3,
      started: 3,
      completed: 3,
      failed: 0
    });
    expect(registrationService.registerOne).toHaveBeenCalledTimes(3);
  });

  it("create mode registers requested count regardless of active count", async () => {
    const registrationService = makeRegistrationService({
      getStats: vi.fn(async () => stats({ activeCount: 100 })),
      registerOne: vi.fn(async () => success(1))
    });
    const job = makeJob({ mode: "create", count: 4, concurrency: 6 });

    const result = await processRegistrationJob(job, registrationService);

    expect(result).toMatchObject({
      mode: "create",
      count: 4,
      activeBefore: 100,
      planned: 4,
      started: 4,
      completed: 4,
      failed: 0
    });
    expect(registrationService.registerOne).toHaveBeenCalledTimes(4);
  });

  it("stops create scheduling when quota is exhausted", async () => {
    const quotaFailure: RegistrationResult = {
      success: false,
      error: "quota exhausted",
      failureKind: "quota_exhausted"
    };
    const registrationService = makeRegistrationService({
      getStats: vi.fn(async () => stats({ activeCount: 0 })),
      registerOne: vi.fn(async () => quotaFailure)
    });
    const job = makeJob({ mode: "create", count: 5, concurrency: 2 });

    await expect(processRegistrationJob(job, registrationService)).resolves.toMatchObject({
      mode: "create",
      count: 5,
      planned: 5,
      started: 1,
      completed: 0,
      failed: 1,
      stoppedEarly: true,
      stopReason: "quota_exhausted",
      results: [quotaFailure]
    });
    expect(registrationService.registerOne).toHaveBeenCalledTimes(1);
    expect(lastProgress(job)).toMatchObject({
      started: 1,
      completed: 0,
      failed: 1,
      total: 5
    });
  });

  it("fill mode skips work when active count already satisfies target", async () => {
    const registrationService = makeRegistrationService({
      getStats: vi.fn(async () => stats({ activeCount: 101 })),
      registerOne: vi.fn(async () => success(1))
    });
    const job = makeJob({ mode: "fill", target: 100, concurrency: 6 });

    const result = await processRegistrationJob(job, registrationService);

    expect(result).toMatchObject({
      mode: "fill",
      target: 100,
      activeBefore: 101,
      planned: 0,
      skipped: 1
    });
    expect(registrationService.registerOne).not.toHaveBeenCalled();
  });

  it("cancels fill before start with normalized bulk result without registering", async () => {
    const registrationService = makeRegistrationService({
      getStats: vi.fn(async () => stats({ activeCount: 1 }))
    });
    const isCancelRequested = vi.fn(async () => true);
    const clearCancelRequest = vi.fn(async () => undefined);
    const job = makeJob({ mode: "fill", target: 3, concurrency: 2 }, 42);

    await expect(
      processRegistrationJob(job, registrationService, { isCancelRequested, clearCancelRequest })
    ).resolves.toEqual({
      canceled: true,
      mode: "fill",
      target: 3,
      concurrency: 2,
      activeBefore: 1,
      planned: 2,
      started: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      results: []
    });

    expect(isCancelRequested).toHaveBeenCalledWith("42");
    expect(clearCancelRequest).toHaveBeenCalledWith("42");
    expect(registrationService.getStats).toHaveBeenCalledTimes(1);
    expect(registrationService.registerOne).not.toHaveBeenCalled();
    expect(lastProgress(job)).toMatchObject({
      started: 0,
      completed: 0,
      failed: 0,
      total: 2
    });
    expect(lastProgress(job).logs.at(-1)).toMatchObject({
      level: "warn",
      message: expect.stringContaining("canceled")
    });
  });

  it("cancels create before start with normalized bulk result without registering", async () => {
    const registrationService = makeRegistrationService({
      getStats: vi.fn(async () => stats({ activeCount: 7 }))
    });
    const isCancelRequested = vi.fn(async () => true);
    const clearCancelRequest = vi.fn(async () => undefined);
    const job = makeJob({ mode: "create", count: 5, concurrency: 4 }, "create-1");

    await expect(
      processRegistrationJob(job, registrationService, { isCancelRequested, clearCancelRequest })
    ).resolves.toEqual({
      canceled: true,
      mode: "create",
      count: 5,
      concurrency: 4,
      activeBefore: 7,
      planned: 5,
      started: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      results: []
    });

    expect(isCancelRequested).toHaveBeenCalledWith("create-1");
    expect(clearCancelRequest).toHaveBeenCalledWith("create-1");
    expect(registrationService.getStats).toHaveBeenCalledTimes(1);
    expect(registrationService.registerOne).not.toHaveBeenCalled();
    expect(lastProgress(job)).toMatchObject({
      started: 0,
      completed: 0,
      failed: 0,
      total: 5
    });
    expect(lastProgress(job).logs.at(-1)).toMatchObject({
      level: "warn",
      message: expect.stringContaining("canceled")
    });
  });

  it("keeps single cancellation before start as a generic canceled result", async () => {
    const registrationService = makeRegistrationService();
    const isCancelRequested = vi.fn(async () => true);
    const clearCancelRequest = vi.fn(async () => undefined);
    const job = makeJob({ mode: "single" }, "single-1");

    await expect(
      processRegistrationJob(job, registrationService, { isCancelRequested, clearCancelRequest })
    ).resolves.toEqual({ canceled: true });

    expect(isCancelRequested).toHaveBeenCalledWith("single-1");
    expect(clearCancelRequest).toHaveBeenCalledWith("single-1");
    expect(registrationService.getStats).not.toHaveBeenCalled();
    expect(registrationService.registerOne).not.toHaveBeenCalled();
    expect(lastProgress(job)).toMatchObject({
      started: 0,
      completed: 0,
      failed: 0,
      total: 0
    });
  });

  it("clears cancel request when pre-start cancellation progress update fails", async () => {
    const registrationService = makeRegistrationService();
    const isCancelRequested = vi.fn(async () => true);
    const clearCancelRequest = vi.fn(async () => undefined);
    const job = makeJob({ mode: "single" });
    job.updateProgress = vi.fn(async () => {
      throw new Error("progress unavailable");
    });

    await expect(
      processRegistrationJob(job, registrationService, { isCancelRequested, clearCancelRequest })
    ).rejects.toThrow("progress unavailable");

    expect(clearCancelRequest).toHaveBeenCalledWith("job-1");
    expect(registrationService.registerOne).not.toHaveBeenCalled();
    expect(registrationService.getStats).not.toHaveBeenCalled();
  });

  it("clears cancel request when single registration progress update fails", async () => {
    const registrationService = makeRegistrationService();
    const clearCancelRequest = vi.fn(async () => undefined);
    const job = makeJob({ mode: "single" });
    job.updateProgress = vi.fn(async () => {
      throw new Error("progress unavailable");
    });

    await expect(
      processRegistrationJob(job, registrationService, { clearCancelRequest })
    ).rejects.toThrow("progress unavailable");

    expect(clearCancelRequest).toHaveBeenCalledWith("job-1");
    expect(registrationService.registerOne).not.toHaveBeenCalled();
    expect(registrationService.getStats).not.toHaveBeenCalled();
  });

  it("cancels fill after stats before the first batch without registering", async () => {
    const registrationService = makeRegistrationService({
      getStats: vi.fn(async () => stats({ activeCount: 1 }))
    });
    const isCancelRequested = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const clearCancelRequest = vi.fn(async () => undefined);
    const job = makeJob({ mode: "fill", target: 4, concurrency: 2 });

    await expect(
      processRegistrationJob(job, registrationService, { isCancelRequested, clearCancelRequest })
    ).resolves.toEqual({
      canceled: true,
      mode: "fill",
      target: 4,
      concurrency: 2,
      activeBefore: 1,
      planned: 3,
      started: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      results: []
    });

    expect(isCancelRequested).toHaveBeenCalledTimes(2);
    expect(clearCancelRequest).toHaveBeenCalledWith("job-1");
    expect(registrationService.getStats).toHaveBeenCalledTimes(1);
    expect(registrationService.registerOne).not.toHaveBeenCalled();
    expect(lastProgress(job)).toMatchObject({
      started: 0,
      completed: 0,
      failed: 0,
      total: 3
    });
    expect(lastProgress(job).logs.at(-1)).toMatchObject({
      level: "warn",
      message: expect.stringContaining("canceled")
    });
  });

  it("resolves fill cancellation when clearing a cancel request fails", async () => {
    const registrationService = makeRegistrationService({
      getStats: vi.fn(async () => stats({ activeCount: 0 }))
    });
    const isCancelRequested = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const clearCancelRequest = vi.fn(async () => {
      throw new Error("redis unavailable");
    });
    const job = makeJob({ mode: "fill", target: 2, concurrency: 1 });

    await expect(
      processRegistrationJob(job, registrationService, { isCancelRequested, clearCancelRequest })
    ).resolves.toEqual({
      canceled: true,
      mode: "fill",
      target: 2,
      concurrency: 1,
      activeBefore: 0,
      planned: 2,
      started: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      results: []
    });

    expect(clearCancelRequest).toHaveBeenCalledWith("job-1");
    expect(registrationService.registerOne).not.toHaveBeenCalled();
  });

  it("cancels during fill before the next batch and returns partial counters", async () => {
    const partialResults = [success(1), failure("rate limited")];
    const registrationService = makeRegistrationService({
      getStats: vi.fn(async () => stats({ activeCount: 0 })),
      registerOne: vi.fn()
        .mockResolvedValueOnce(partialResults[0])
        .mockResolvedValueOnce(partialResults[1])
    });
    const isCancelRequested = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const clearCancelRequest = vi.fn(async () => undefined);
    const job = makeJob({ mode: "fill", target: 3, concurrency: 2 });

    await expect(
      processRegistrationJob(job, registrationService, { isCancelRequested, clearCancelRequest })
    ).resolves.toEqual({
      canceled: true,
      mode: "fill",
      target: 3,
      concurrency: 2,
      activeBefore: 0,
      planned: 3,
      started: 2,
      completed: 1,
      failed: 1,
      skipped: 0,
      results: partialResults
    });

    expect(isCancelRequested).toHaveBeenCalledTimes(4);
    expect(clearCancelRequest).toHaveBeenCalledWith("job-1");
    expect(registrationService.registerOne).toHaveBeenCalledTimes(2);
    expect(lastProgress(job)).toMatchObject({
      started: 2,
      completed: 1,
      failed: 1,
      total: 3
    });
    expect(lastProgress(job).logs.at(-1)).toMatchObject({
      level: "warn",
      message: expect.stringContaining("canceled")
    });
  });

  it("cancels create after stats before the first batch without registering", async () => {
    const registrationService = makeRegistrationService({
      getStats: vi.fn(async () => stats({ activeCount: 5 }))
    });
    const isCancelRequested = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const clearCancelRequest = vi.fn(async () => undefined);
    const job = makeJob({ mode: "create", count: 4, concurrency: 3 });

    await expect(
      processRegistrationJob(job, registrationService, { isCancelRequested, clearCancelRequest })
    ).resolves.toEqual({
      canceled: true,
      mode: "create",
      count: 4,
      concurrency: 3,
      activeBefore: 5,
      planned: 4,
      started: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      results: []
    });

    expect(isCancelRequested).toHaveBeenCalledTimes(2);
    expect(clearCancelRequest).toHaveBeenCalledWith("job-1");
    expect(registrationService.getStats).toHaveBeenCalledTimes(1);
    expect(registrationService.registerOne).not.toHaveBeenCalled();
    expect(lastProgress(job)).toMatchObject({
      started: 0,
      completed: 0,
      failed: 0,
      total: 4
    });
  });

  it("rejects unsupported registration job modes", async () => {
    const registrationService = makeRegistrationService();
    const clearCancelRequest = vi.fn(async () => undefined);
    const job = makeJob({ mode: "unknown" } as unknown as RegistrationJobPayload);

    await expect(
      processRegistrationJob(job, registrationService, { clearCancelRequest })
    ).rejects.toThrow("unsupported registration job mode");

    expect(clearCancelRequest).toHaveBeenCalledWith("job-1");
    expect(registrationService.getStats).not.toHaveBeenCalled();
    expect(registrationService.registerOne).not.toHaveBeenCalled();
    expect(job.updateProgress).not.toHaveBeenCalled();
  });
});

describe("createRegistrationWorker", () => {
  beforeEach(() => {
    bullmqMocks.workerInstances.length = 0;
    vi.clearAllMocks();
  });

  it("constructs a registration Worker and delegates processing", async () => {
    const result = { success: true };
    const registrationService = {
      registerOne: vi.fn(async () => result),
      getStats: vi.fn()
    } as unknown as RegistrationService;
    const isCancelRequested = vi.fn(async () => false);
    const clearCancelRequest = vi.fn(async () => undefined);

    const worker = createRegistrationWorker({
      redisUrl: "redis://localhost:6380/2",
      queuePrefix: "navos",
      concurrency: 4,
      registrationService,
      isCancelRequested,
      clearCancelRequest
    });

    expect(worker).toBe(bullmqMocks.workerInstances[0]);
    expect(bullmqMocks.workerInstances).toHaveLength(1);
    expect(bullmqMocks.workerInstances[0]).toMatchObject({
      name: "registration",
      options: {
        prefix: "navos",
        concurrency: 4,
        connection: {
          host: "localhost",
          port: 6380,
          db: 2,
          maxRetriesPerRequest: null
        }
      }
    });

    const job = {
      id: "worker-job",
      data: { mode: "single" },
      updateProgress: vi.fn(async () => undefined)
    } satisfies TestJob;
    await expect(bullmqMocks.workerInstances[0]!.processor(job)).resolves.toBe(result);

    expect(registrationService.registerOne).toHaveBeenCalledTimes(1);
    expect(isCancelRequested).toHaveBeenCalledWith("worker-job");
    expect(clearCancelRequest).toHaveBeenCalledWith("worker-job");
  });
});
