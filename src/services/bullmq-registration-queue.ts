import { Queue, type ConnectionOptions, type Job, type JobState, type JobType } from "bullmq";
import { Redis } from "ioredis";
import {
  RegistrationQueueUnavailableError,
  type RegistrationQueuePort
} from "./registration-job-service.js";
import type {
  RegistrationJobLog,
  RegistrationJobPayload,
  RegistrationJobProgress,
  RegistrationJobSnapshot,
  RegistrationJobState
} from "./registration-job-types.js";

export interface BullmqRegistrationQueueOptions {
  redisUrl: string;
  queuePrefix: string;
  removeOnComplete: number;
  removeOnFail: number;
}

type RegistrationBullJob = Job<RegistrationJobPayload, unknown, string>;

const QUEUE_NAME = "registration";
const CANCEL_TTL_SECONDS = 86_400;
const RECENT_JOB_LIMIT = 50;
const RECENT_JOB_TYPES: JobType[] = ["waiting", "active", "completed", "failed", "delayed"];
const PRODUCER_REDIS_OPTIONS = {
  maxRetriesPerRequest: 1,
  connectTimeout: 5_000,
  commandTimeout: 5_000
};

export class BullmqRegistrationQueue implements RegistrationQueuePort {
  private readonly queue: Queue<RegistrationJobPayload, unknown, string>;
  private readonly redis: Redis;

  constructor(private readonly options: BullmqRegistrationQueueOptions) {
    this.redis = new Redis(options.redisUrl, PRODUCER_REDIS_OPTIONS);
    this.queue = new Queue<RegistrationJobPayload, unknown, string>(QUEUE_NAME, {
      connection: this.redis as unknown as ConnectionOptions,
      prefix: options.queuePrefix
    });
  }

  async add(data: RegistrationJobPayload): Promise<string> {
    try {
      const job = await this.queue.add(QUEUE_NAME, data, {
        removeOnComplete: this.options.removeOnComplete,
        removeOnFail: this.options.removeOnFail
      });
      if (!job.id) {
        throw new Error("BullMQ did not return a job id");
      }
      return String(job.id);
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : "";
      throw new RegistrationQueueUnavailableError(`registration queue unavailable${detail}`);
    }
  }

  async get(id: string): Promise<RegistrationJobSnapshot | undefined> {
    const job = await this.queue.getJob(id);
    if (!job) {
      return undefined;
    }
    return this.toSnapshot(job);
  }

  async list(): Promise<RegistrationJobSnapshot[]> {
    const jobs = await this.queue.getJobs(RECENT_JOB_TYPES, 0, RECENT_JOB_LIMIT - 1, false);
    const recentJobs = [...jobs]
      .filter((job) => job !== undefined)
      .sort((left, right) => jobTimestamp(right) - jobTimestamp(left))
      .slice(0, RECENT_JOB_LIMIT);
    return Promise.all(recentJobs.map((job) => this.toSnapshot(job, undefined, false)));
  }

  async cancel(id: string): Promise<RegistrationJobSnapshot | undefined> {
    const job = await this.queue.getJob(id);
    if (!job) {
      return undefined;
    }

    const state = await job.getState();
    if (state === "waiting" || state === "delayed") {
      return this.cancelQueuedJob(id, job, state);
    }

    if (state === "active") {
      return this.recordRunningCancelRequest(id, job, state);
    }

    return this.toSnapshot(job, state);
  }

  private async cancelQueuedJob(
    id: string,
    job: RegistrationBullJob,
    knownState: JobState
  ): Promise<RegistrationJobSnapshot> {
    try {
      await job.remove();
      return {
        ...(await this.toSnapshot(job, knownState)),
        state: "canceled",
        finishedAt: Date.now()
      };
    } catch {
      const currentState = await this.safeJobState(job, "active");
      if (currentState === "completed" || currentState === "failed" || currentState === "unknown") {
        return this.toSnapshot(job, currentState);
      }
      return this.recordRunningCancelRequest(id, job, currentState);
    }
  }

  private async recordRunningCancelRequest(
    id: string,
    job: RegistrationBullJob,
    knownState: JobState | "unknown"
  ): Promise<RegistrationJobSnapshot> {
    await this.redis.set(this.cancelKey(id), "1", "EX", CANCEL_TTL_SECONDS);
    if (typeof job.updateData === "function") {
      try {
        await job.updateData({ ...job.data, cancelRequested: true });
      } catch {
        return this.toSnapshot(job, await this.safeJobState(job, knownState));
      }
    }
    return this.toSnapshot(job, knownState);
  }

  private async safeJobState(
    job: RegistrationBullJob,
    fallback: JobState | "unknown"
  ): Promise<JobState | "unknown"> {
    try {
      return await job.getState();
    } catch {
      return fallback;
    }
  }

  async isCancelRequested(id: string): Promise<boolean> {
    return (await this.redis.get(this.cancelKey(id))) === "1";
  }

  async clearCancelRequest(id: string): Promise<void> {
    await this.redis.del(this.cancelKey(id));
  }

  async close(): Promise<void> {
    try {
      await this.queue.close();
    } finally {
      try {
        await this.redis.quit();
      } catch {
        this.redis.disconnect();
      }
    }
  }

  private cancelKey(id: string): string {
    return `${this.options.queuePrefix}:${QUEUE_NAME}:cancel:${id}`;
  }

  private async toSnapshot(
    job: RegistrationBullJob,
    knownState?: JobState | "unknown",
    includeFullLogs = true
  ): Promise<RegistrationJobSnapshot> {
    const bullState = knownState ?? await job.getState();
    const logs = includeFullLogs ? await this.logsForJob(job) : normalizeLogs(job.progress);
    const snapshot: RegistrationJobSnapshot = {
      id: String(job.id),
      mode: job.data.mode,
      state: mapBullState(bullState, job.returnvalue),
      progress: normalizeProgress(job.progress),
      logs,
      createdAt: job.timestamp ?? 0
    };

    if (job.data.mode === "fill") {
      snapshot.target = job.data.target;
      snapshot.concurrency = job.data.concurrency;
    }
    if (job.returnvalue !== undefined && job.returnvalue !== null) {
      snapshot.results = job.returnvalue;
    }
    if (job.failedReason) {
      snapshot.error = job.failedReason;
    }
    if (job.processedOn !== undefined) {
      snapshot.startedAt = job.processedOn;
    }
    if (job.finishedOn !== undefined) {
      snapshot.finishedAt = job.finishedOn;
    }

    return snapshot;
  }

  private async logsForJob(job: RegistrationBullJob): Promise<RegistrationJobLog[]> {
    const progressLogs = normalizeLogs(job.progress);
    if (!job.id) {
      return progressLogs;
    }

    const { logs } = await this.queue.getJobLogs(String(job.id), 0, -1, true);
    const bullLogs = logs.map(parseLogRow);
    return bullLogs.length > 0 ? bullLogs : progressLogs;
  }
}

function mapBullState(state: JobState | "unknown", returnvalue: unknown): RegistrationJobState {
  if (state === "completed" && isRecord(returnvalue) && returnvalue.canceled === true) {
    return "canceled";
  }
  if (state === "completed") {
    return "succeeded";
  }
  if (state === "failed") {
    return "failed";
  }
  if (state === "active") {
    return "running";
  }
  return "queued";
}

function normalizeProgress(progress: unknown): RegistrationJobProgress {
  if (!isRecord(progress)) {
    return { started: 0, completed: 0, failed: 0, total: 0 };
  }
  return {
    started: finiteNumber(progress.started),
    completed: finiteNumber(progress.completed),
    failed: finiteNumber(progress.failed),
    total: finiteNumber(progress.total)
  };
}

function normalizeLogs(progress: unknown): RegistrationJobLog[] {
  if (!isRecord(progress) || !Array.isArray(progress.logs)) {
    return [];
  }

  return progress.logs.filter(isRegistrationJobLog);
}

function jobTimestamp(job: RegistrationBullJob): number {
  return job.timestamp ?? 0;
}

function parseLogRow(row: string): RegistrationJobLog {
  try {
    const parsed: unknown = JSON.parse(row);
    if (isRegistrationJobLog(parsed)) {
      return parsed;
    }
  } catch {
    // BullMQ accepts plain string log rows; expose them as info messages.
  }

  return { at: 0, level: "info", message: row };
}

function isRegistrationJobLog(value: unknown): value is RegistrationJobLog {
  return (
    isRecord(value) &&
    typeof value.at === "number" &&
    (value.level === "info" || value.level === "warn" || value.level === "error") &&
    typeof value.message === "string"
  );
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
