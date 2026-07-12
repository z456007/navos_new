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
    this.name = "RegistrationJobNotFoundError";
  }
}

export class RegistrationQueueUnavailableError extends Error {
  constructor(message = "registration queue unavailable") {
    super(message);
    this.name = "RegistrationQueueUnavailableError";
  }
}

export class RegistrationJobValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistrationJobValidationError";
  }
}

export interface RegistrationJobServiceOptions {
  defaultTarget: number;
  defaultConcurrency: number;
  maxConcurrency?: number;
}

const MAX_BULK_REGISTRATION_COUNT = 100000;
const DEFAULT_MAX_REGISTRATION_CONCURRENCY = 5000;

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
    const rawInput = this.validateInputObject(input);
    const mode = rawInput.mode;
    if (mode !== "single" && mode !== "fill" && mode !== "create") {
      throw new RegistrationJobValidationError('mode must be one of "single", "fill", or "create"');
    }

    if (mode === "single") {
      return { mode: "single" };
    }

    const concurrency = rawInput.concurrency === undefined ? this.options.defaultConcurrency : rawInput.concurrency;
    const maxConcurrency = this.options.maxConcurrency ?? DEFAULT_MAX_REGISTRATION_CONCURRENCY;
    if (
      typeof concurrency !== "number" ||
      !Number.isInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > maxConcurrency
    ) {
      throw new RegistrationJobValidationError(`concurrency must be an integer from 1 to ${maxConcurrency}`);
    }

    if (mode === "fill") {
      const target = rawInput.target === undefined ? this.options.defaultTarget : rawInput.target;
      if (typeof target !== "number" || !Number.isInteger(target) || target < 1 || target > MAX_BULK_REGISTRATION_COUNT) {
        throw new RegistrationJobValidationError(`target must be an integer from 1 to ${MAX_BULK_REGISTRATION_COUNT}`);
      }
      return { mode: "fill", target, concurrency };
    }

    const count = rawInput.count;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > MAX_BULK_REGISTRATION_COUNT) {
      throw new RegistrationJobValidationError(`count must be an integer from 1 to ${MAX_BULK_REGISTRATION_COUNT}`);
    }
    return { mode: "create", count, concurrency };
  }

  private validateInputObject(input: RegistrationJobCreateInput): Record<string, unknown> {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new RegistrationJobValidationError("registration job input must be an object");
    }
    return input;
  }
}
