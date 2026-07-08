import type {
  RegistrationJobCreateResponse,
  RegistrationJobCreateInput,
  RegistrationJobPayload,
  RegistrationJobSnapshot
} from "./registration-job-types.js";

export interface RegistrationQueuePort {
  add(data: RegistrationJobPayload): Promise<string>;
  get(id: string): Promise<RegistrationJobSnapshot | undefined>;
  list(): Promise<RegistrationJobSnapshot[]>;
  cancel(id: string): Promise<RegistrationJobSnapshot | undefined>;
}

export class RegistrationJobNotFoundError extends Error {
  constructor() {
    super("registration job not found");
  }
}

export class RegistrationQueueUnavailableError extends Error {
  constructor(message = "registration queue unavailable") {
    super(message);
  }
}

export interface RegistrationJobServiceOptions {
  defaultTarget: number;
  defaultConcurrency: number;
}

export interface RegistrationJobServicePort {
  createJob(input: RegistrationJobCreateInput): Promise<RegistrationJobCreateResponse>;
  getJob(id: string): Promise<RegistrationJobSnapshot | undefined>;
  listJobs(): Promise<RegistrationJobSnapshot[]>;
  cancelJob(id: string): Promise<RegistrationJobSnapshot>;
}

export class RegistrationJobService implements RegistrationJobServicePort {
  constructor(
    private readonly queue: RegistrationQueuePort,
    private readonly options: RegistrationJobServiceOptions
  ) {}

  async createJob(input: RegistrationJobCreateInput): Promise<RegistrationJobCreateResponse> {
    const payload = this.normalizePayload(input);
    return { jobId: await this.queue.add(payload) };
  }

  async getJob(id: string): Promise<RegistrationJobSnapshot | undefined> {
    return this.queue.get(id);
  }

  async listJobs(): Promise<RegistrationJobSnapshot[]> {
    return this.queue.list();
  }

  async cancelJob(id: string): Promise<RegistrationJobSnapshot> {
    const snapshot = await this.queue.cancel(id);
    if (!snapshot) {
      throw new RegistrationJobNotFoundError();
    }
    return snapshot;
  }

  private normalizePayload(input: RegistrationJobCreateInput): RegistrationJobPayload {
    if (input.mode === "single") {
      return { mode: "single" };
    }
    const target = input.target ?? this.options.defaultTarget;
    const concurrency = input.concurrency ?? this.options.defaultConcurrency;
    if (!Number.isInteger(target) || target < 1 || target > 500) {
      throw new Error("target must be an integer from 1 to 500");
    }
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
      throw new Error("concurrency must be an integer from 1 to 20");
    }
    return { mode: "fill", target, concurrency };
  }
}
