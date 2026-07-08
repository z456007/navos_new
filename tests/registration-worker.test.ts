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

  it("rejects malformed fill concurrency without registering", async () => {
    const registrationService = makeRegistrationService({
      getStats: vi.fn(async () => stats({ activeCount: 0 }))
    });
    const job = makeJob({ mode: "fill", target: 2, concurrency: 0 });

    await expect(processRegistrationJob(job, registrationService)).rejects.toThrow(
      "fill registration concurrency must be greater than 0"
    );

    expect(registrationService.getStats).toHaveBeenCalledTimes(1);
    expect(registrationService.registerOne).not.toHaveBeenCalled();
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

  it("cancels before start without registering", async () => {
    const registrationService = makeRegistrationService();
    const isCancelRequested = vi.fn(async () => true);
    const clearCancelRequest = vi.fn(async () => undefined);
    const job = makeJob({ mode: "fill", target: 3, concurrency: 2 }, 42);

    await expect(
      processRegistrationJob(job, registrationService, { isCancelRequested, clearCancelRequest })
    ).resolves.toEqual({ canceled: true });

    expect(isCancelRequested).toHaveBeenCalledWith("42");
    expect(clearCancelRequest).toHaveBeenCalledWith("42");
    expect(registrationService.getStats).not.toHaveBeenCalled();
    expect(registrationService.registerOne).not.toHaveBeenCalled();
    expect(lastProgress(job)).toMatchObject({
      started: 0,
      completed: 0,
      failed: 0,
      total: 0,
      logs: [expect.objectContaining({ level: "warn" })]
    });
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
      target: 4,
      started: 0,
      completed: 0,
      failed: 0,
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
      target: 2,
      started: 0,
      completed: 0,
      failed: 0,
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
      .mockResolvedValueOnce(true);
    const clearCancelRequest = vi.fn(async () => undefined);
    const job = makeJob({ mode: "fill", target: 3, concurrency: 2 });

    await expect(
      processRegistrationJob(job, registrationService, { isCancelRequested, clearCancelRequest })
    ).resolves.toEqual({
      canceled: true,
      target: 3,
      started: 2,
      completed: 1,
      failed: 1,
      results: partialResults
    });

    expect(isCancelRequested).toHaveBeenCalledTimes(3);
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
