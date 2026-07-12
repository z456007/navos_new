import { Worker, type ConnectionOptions, type Job } from "bullmq";
import type { RegistrationResult, RegistrationService } from "./registration-service.js";
import { RegistrationScheduler } from "./registration-scheduler.js";
import type {
  RegistrationJobLog,
  RegistrationJobPayload,
  RegistrationJobProgress
} from "./registration-job-types.js";

const QUEUE_NAME = "registration";
const MIN_BULK_COUNT = 1;
const MAX_BULK_COUNT = 100000;
const MIN_BULK_CONCURRENCY = 1;
const MAX_BULK_CONCURRENCY = 5000;

export interface RegistrationWorkerOptions {
  redisUrl: string;
  queuePrefix: string;
  concurrency: number;
  registrationService: RegistrationService;
  isCancelRequested?: (jobId: string) => Promise<boolean>;
  clearCancelRequest?: (jobId: string) => Promise<void>;
}

export interface RegistrationProcessorOptions {
  isCancelRequested?: (jobId: string) => Promise<boolean>;
  clearCancelRequest?: (jobId: string) => Promise<void>;
}

type RegistrationWorkerJob = Pick<Job<RegistrationJobPayload>, "id" | "data" | "updateProgress">;
type ProgressWithLogs = RegistrationJobProgress & { logs: RegistrationJobLog[] };
type BulkRegistrationJobPayload = Extract<RegistrationJobPayload, { mode: "fill" | "create" }>;

interface BulkRegistrationJobResult {
  mode: "fill" | "create";
  target?: number;
  count?: number;
  concurrency: number;
  activeBefore: number;
  planned: number;
  started: number;
  completed: number;
  failed: number;
  skipped: number;
  results: RegistrationResult[];
  stoppedEarly?: true;
  stopReason?: "quota_exhausted";
}

export async function processRegistrationJob(
  job: RegistrationWorkerJob,
  registrationService: RegistrationService,
  options: RegistrationProcessorOptions = {}
): Promise<unknown> {
  const jobId = String(job.id);
  const progress = createProgressTracker(job);
  const data = job.data;

  try {
    const preStartCanceled = await isCancellationRequested(job, jobId, options);
    if (preStartCanceled && data.mode === "single") {
      await progress.update(0, 0, 0, 0, "warn", "registration job canceled before start");
      return { canceled: true };
    }

    if (data.mode === "single") {
      return await processSingleRegistration(progress, registrationService);
    }

    if (data.mode === "fill" || data.mode === "create") {
      return await processBulkRegistration(jobId, data, progress, registrationService, options, preStartCanceled);
    }

    throw new Error("unsupported registration job mode");
  } finally {
    await clearCancelRequestBestEffort(jobId, options);
  }
}

export function createRegistrationWorker(options: RegistrationWorkerOptions): Worker<RegistrationJobPayload> {
  return new Worker<RegistrationJobPayload>(
    QUEUE_NAME,
    (job) => processRegistrationJob(job, options.registrationService, {
      isCancelRequested: options.isCancelRequested,
      clearCancelRequest: options.clearCancelRequest
    }),
    {
      connection: parseRedisConnectionOptions(options.redisUrl),
      prefix: options.queuePrefix,
      concurrency: options.concurrency
    }
  );
}

async function processSingleRegistration(
  progress: ReturnType<typeof createProgressTracker>,
  registrationService: RegistrationService
): Promise<RegistrationResult> {
  await progress.update(1, 0, 0, 1, "info", "single registration started");

  let result: RegistrationResult;
  try {
    result = await registrationService.registerOne();
  } catch (error) {
    const message = errorMessage(error, "single registration failed");
    await progress.update(1, 0, 1, 1, "error", "single registration failed");
    throw new Error(message);
  }

  if (!result.success) {
    await progress.update(1, 0, 1, 1, "error", "single registration failed");
    throw new Error(result.error ?? "single registration failed");
  }

  await progress.update(1, 1, 0, 1, "info", "single registration completed");
  return result;
}

async function processBulkRegistration(
  jobId: string,
  data: BulkRegistrationJobPayload,
  progress: ReturnType<typeof createProgressTracker>,
  registrationService: RegistrationService,
  options: RegistrationProcessorOptions,
  preStartCanceled = false
): Promise<unknown> {
  validateBulkRegistrationPayload(data);

  const stats = await registrationService.getStats();
  const planned = data.mode === "fill" ? Math.max(0, data.target - stats.activeCount) : data.count;
  const skipped = planned === 0 ? 1 : 0;

  await progress.update(
    0,
    0,
    0,
    planned,
    "info",
    `${data.mode} registration started`,
    skipped === 1 ? skipped : undefined
  );

  if (preStartCanceled) {
    await progress.update(
      0,
      0,
      0,
      planned,
      "warn",
      `${data.mode} registration canceled`,
      skipped === 1 ? skipped : undefined
    );
    return createCanceledBulkRegistrationJobResult(
      data,
      stats.activeCount,
      planned,
      0,
      0,
      0,
      skipped,
      []
    );
  }

  if (planned === 0) {
    return createBulkRegistrationJobResult(data, stats.activeCount, planned, 0, 0, 0, skipped, []);
  }

  if (await isCancellationRequestedForId(jobId, options)) {
    await progress.update(0, 0, 0, planned, "warn", `${data.mode} registration canceled`);
    return createCanceledBulkRegistrationJobResult(
      data,
      stats.activeCount,
      planned,
      0,
      0,
      0,
      skipped,
      []
    );
  }

  const scheduler = new RegistrationScheduler({ maxInFlightAttempts: data.concurrency });
  const schedulerResult = await scheduler.run({
    planned,
    runAttempt: async () => registerOneSafely(registrationService),
    shouldStopScheduling: async () => isCancellationRequestedForId(jobId, options),
    probeFirstAttempt: data.mode === "create",
    onProgress: async (nextProgress) => {
      const message = nextProgress.results.length < nextProgress.started
        ? `${data.mode} registration batch started`
        : `${data.mode} registration batch completed`;
      await progress.update(
        nextProgress.started,
        nextProgress.completed,
        nextProgress.failed,
        nextProgress.total,
        "info",
        message,
        skipped === 1 ? skipped : undefined
      );
    }
  });

  if (schedulerResult.stopReason === "canceled") {
    await progress.update(
      schedulerResult.started,
      schedulerResult.completed,
      schedulerResult.failed,
      planned,
      "warn",
      `${data.mode} registration canceled`,
      skipped === 1 ? skipped : undefined
    );
    return createCanceledBulkRegistrationJobResult(
      data,
      stats.activeCount,
      planned,
      schedulerResult.started,
      schedulerResult.completed,
      schedulerResult.failed,
      skipped,
      schedulerResult.results
    );
  }

  return createBulkRegistrationJobResult(
    data,
    stats.activeCount,
    planned,
    schedulerResult.started,
    schedulerResult.completed,
    schedulerResult.failed,
    skipped,
    schedulerResult.results,
    schedulerResult.stoppedEarly && schedulerResult.stopReason === "quota_exhausted"
      ? { stoppedEarly: true, stopReason: schedulerResult.stopReason }
      : undefined
  );
}

function createCanceledBulkRegistrationJobResult(
  data: BulkRegistrationJobPayload,
  activeBefore: number,
  planned: number,
  started: number,
  completed: number,
  failed: number,
  skipped: number,
  results: RegistrationResult[]
): BulkRegistrationJobResult & { canceled: true } {
  return {
    canceled: true,
    ...createBulkRegistrationJobResult(data, activeBefore, planned, started, completed, failed, skipped, results)
  };
}

function createBulkRegistrationJobResult(
  data: BulkRegistrationJobPayload,
  activeBefore: number,
  planned: number,
  started: number,
  completed: number,
  failed: number,
  skipped: number,
  results: RegistrationResult[],
  stop?: { stoppedEarly: true; stopReason: "quota_exhausted" }
): BulkRegistrationJobResult {
  return {
    mode: data.mode,
    ...bulkRequestFields(data),
    concurrency: data.concurrency,
    activeBefore,
    planned,
    started,
    completed,
    failed,
    skipped,
    results,
    ...(stop?.stoppedEarly ? { stoppedEarly: true as const, stopReason: stop.stopReason } : {})
  };
}

function bulkRequestFields(data: BulkRegistrationJobPayload): { target: number } | { count: number } {
  return data.mode === "fill" ? { target: data.target } : { count: data.count };
}

function validateBulkRegistrationPayload(data: BulkRegistrationJobPayload): void {
  if (data.mode === "fill" && (!Number.isSafeInteger(data.target) || data.target < MIN_BULK_COUNT || data.target > MAX_BULK_COUNT)) {
    throw new Error(`fill registration target must be an integer from 1 to ${MAX_BULK_COUNT}`);
  }
  if (data.mode === "create" && (!Number.isSafeInteger(data.count) || data.count < MIN_BULK_COUNT || data.count > MAX_BULK_COUNT)) {
    throw new Error(`create registration count must be an integer from 1 to ${MAX_BULK_COUNT}`);
  }
  if (
    !Number.isSafeInteger(data.concurrency)
    || data.concurrency < MIN_BULK_CONCURRENCY
    || data.concurrency > MAX_BULK_CONCURRENCY
  ) {
    throw new Error(`bulk registration concurrency must be an integer from 1 to ${MAX_BULK_CONCURRENCY}`);
  }
}

async function registerOneSafely(registrationService: RegistrationService): Promise<RegistrationResult> {
  try {
    return await registrationService.registerOne();
  } catch (error) {
    return { success: false, error: errorMessage(error, "registration failed") };
  }
}

function createProgressTracker(job: RegistrationWorkerJob): {
  update: (
    started: number,
    completed: number,
    failed: number,
    total: number,
    level: RegistrationJobLog["level"],
    message: string,
    skipped?: number
  ) => Promise<void>;
} {
  const logs: RegistrationJobLog[] = [];

  return {
    async update(started, completed, failed, total, level, message, skipped) {
      logs.push({ at: Date.now(), level, message });
      const nextProgress: ProgressWithLogs = {
        started,
        completed,
        failed,
        total,
        ...(skipped === undefined ? {} : { skipped }),
        logs: [...logs]
      };
      await job.updateProgress(nextProgress);
    }
  };
}

async function isCancellationRequested(
  job: RegistrationWorkerJob,
  jobId: string,
  options: RegistrationProcessorOptions
): Promise<boolean> {
  return job.data.cancelRequested === true || isCancellationRequestedForId(jobId, options);
}

async function isCancellationRequestedForId(
  jobId: string,
  options: RegistrationProcessorOptions
): Promise<boolean> {
  return options.isCancelRequested ? options.isCancelRequested(jobId) : false;
}

async function clearCancelRequest(jobId: string, options: RegistrationProcessorOptions): Promise<void> {
  if (options.clearCancelRequest) {
    await options.clearCancelRequest(jobId);
  }
}

async function clearCancelRequestBestEffort(
  jobId: string,
  options: RegistrationProcessorOptions
): Promise<void> {
  try {
    await clearCancelRequest(jobId, options);
  } catch {
    // Cleanup is best-effort; it must not change the terminal job outcome.
  }
}

function parseRedisConnectionOptions(redisUrl: string): ConnectionOptions {
  const parsed = new URL(redisUrl);
  const db = Number.parseInt(parsed.pathname.replace("/", ""), 10);
  const connection: ConnectionOptions = {
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
    maxRetriesPerRequest: null
  };

  if (parsed.username) {
    connection.username = decodeURIComponent(parsed.username);
  }
  if (parsed.password) {
    connection.password = decodeURIComponent(parsed.password);
  }
  if (Number.isInteger(db) && db >= 0) {
    connection.db = db;
  }
  if (parsed.protocol === "rediss:") {
    connection.tls = {};
  }

  return connection;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
