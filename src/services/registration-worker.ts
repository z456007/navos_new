import { Worker, type ConnectionOptions, type Job } from "bullmq";
import type { RegistrationResult, RegistrationService } from "./registration-service.js";
import type {
  RegistrationJobLog,
  RegistrationJobPayload,
  RegistrationJobProgress
} from "./registration-job-types.js";

const QUEUE_NAME = "registration";
const MIN_BULK_COUNT = 1;
const MAX_BULK_COUNT = 500;
const MIN_BULK_CONCURRENCY = 1;
const MAX_BULK_CONCURRENCY = 20;

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
    if (await isCancellationRequested(job, jobId, options)) {
      await progress.update(0, 0, 0, 0, "warn", "registration job canceled before start");
      return { canceled: true };
    }

    if (data.mode === "single") {
      return await processSingleRegistration(progress, registrationService);
    }

    if (data.mode === "fill" || data.mode === "create") {
      return await processBulkRegistration(jobId, data, progress, registrationService, options);
    }
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
  options: RegistrationProcessorOptions
): Promise<unknown> {
  validateBulkRegistrationPayload(data);

  const stats = await registrationService.getStats();
  const planned = data.mode === "fill" ? Math.max(0, data.target - stats.activeCount) : data.count;
  let started = 0;
  let completed = 0;
  let failed = 0;
  const skipped = planned === 0 ? 1 : 0;
  const results: RegistrationResult[] = [];

  await progress.update(
    started,
    completed,
    failed,
    planned,
    "info",
    `${data.mode} registration started`,
    skipped === 1 ? skipped : undefined
  );

  if (planned === 0) {
    return createBulkRegistrationJobResult(data, stats.activeCount, planned, started, completed, failed, skipped, results);
  }

  if (await isCancellationRequestedForId(jobId, options)) {
    await progress.update(started, completed, failed, planned, "warn", `${data.mode} registration canceled`);
    return {
      canceled: true,
      ...bulkRequestFields(data),
      started,
      completed,
      failed,
      results
    };
  }

  while (started < planned) {
    if (await isCancellationRequestedForId(jobId, options)) {
      await progress.update(started, completed, failed, planned, "warn", `${data.mode} registration canceled`);
      return {
        canceled: true,
        ...bulkRequestFields(data),
        started,
        completed,
        failed,
        results
      };
    }

    const batchSize = Math.min(data.concurrency, planned - started);
    started += batchSize;
    await progress.update(started, completed, failed, planned, "info", `${data.mode} registration batch started`);

    const batch = Array.from({ length: batchSize }, () => registerOneSafely(registrationService));
    const batchResults = await Promise.all(batch);
    results.push(...batchResults);
    completed = results.filter((result) => result.success).length;
    failed = results.length - completed;

    await progress.update(started, completed, failed, planned, "info", `${data.mode} registration batch completed`);
  }

  return createBulkRegistrationJobResult(data, stats.activeCount, planned, started, completed, failed, skipped, results);
}

function createBulkRegistrationJobResult(
  data: BulkRegistrationJobPayload,
  activeBefore: number,
  planned: number,
  started: number,
  completed: number,
  failed: number,
  skipped: number,
  results: RegistrationResult[]
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
    results
  };
}

function bulkRequestFields(data: BulkRegistrationJobPayload): { target: number } | { count: number } {
  return data.mode === "fill" ? { target: data.target } : { count: data.count };
}

function validateBulkRegistrationPayload(data: BulkRegistrationJobPayload): void {
  if (data.mode === "fill" && (!Number.isSafeInteger(data.target) || data.target < MIN_BULK_COUNT || data.target > MAX_BULK_COUNT)) {
    throw new Error("fill registration target must be an integer from 1 to 500");
  }
  if (data.mode === "create" && (!Number.isSafeInteger(data.count) || data.count < MIN_BULK_COUNT || data.count > MAX_BULK_COUNT)) {
    throw new Error("create registration count must be an integer from 1 to 500");
  }
  if (
    !Number.isSafeInteger(data.concurrency)
    || data.concurrency < MIN_BULK_CONCURRENCY
    || data.concurrency > MAX_BULK_CONCURRENCY
  ) {
    throw new Error("bulk registration concurrency must be an integer from 1 to 20");
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
