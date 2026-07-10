import type { RegistrationResult } from "./registration-service.js";

export type RegistrationSchedulerStopReason = "quota_exhausted" | "canceled";

export interface RegistrationSchedulerOptions {
  maxInFlightAttempts: number;
}

export interface RegistrationSchedulerProgress {
  started: number;
  completed: number;
  failed: number;
  total: number;
  results: RegistrationResult[];
}

export interface RegistrationSchedulerRunOptions {
  planned: number;
  runAttempt: (index: number) => Promise<RegistrationResult>;
  onProgress: (progress: RegistrationSchedulerProgress) => Promise<void>;
  shouldStopScheduling?: () => Promise<boolean>;
  probeFirstAttempt?: boolean;
}

export interface RegistrationSchedulerResult extends RegistrationSchedulerProgress {
  stoppedEarly?: boolean;
  stopReason?: RegistrationSchedulerStopReason;
}

export class RegistrationScheduler {
  private readonly maxInFlightAttempts: number;

  constructor(options: RegistrationSchedulerOptions) {
    this.maxInFlightAttempts = normalizePositiveInteger(options.maxInFlightAttempts);
  }

  async run(options: RegistrationSchedulerRunOptions): Promise<RegistrationSchedulerResult> {
    const total = options.planned;
    if (!Number.isSafeInteger(total) || total < 0) {
      throw new Error("planned must be a non-negative integer");
    }

    let started = 0;
    let completed = 0;
    let failed = 0;
    let stoppedEarly = false;
    let stopReason: RegistrationSchedulerStopReason | undefined;
    const resultsByIndex: Array<RegistrationResult | undefined> = [];

    const snapshot = (): RegistrationSchedulerProgress => ({
      started,
      completed,
      failed,
      total,
      results: compactResults(resultsByIndex)
    });

    const stop = (reason: RegistrationSchedulerStopReason): void => {
      if (!stoppedEarly) {
        stoppedEarly = true;
        stopReason = reason;
      }
    };

    const executeAttempt = async (index: number): Promise<void> => {
      let result: RegistrationResult;
      try {
        result = await options.runAttempt(index);
      } catch (error) {
        result = {
          success: false,
          error: error instanceof Error && error.message ? error.message : "registration failed"
        };
      }

      resultsByIndex[index] = result;
      if (result.success) {
        completed += 1;
      } else {
        failed += 1;
        if (result.failureKind === "quota_exhausted") {
          stop("quota_exhausted");
        }
      }
    };

    while (started < total && !stoppedEarly) {
      if (options.shouldStopScheduling && await options.shouldStopScheduling()) {
        stop("canceled");
        break;
      }

      if (!(options.probeFirstAttempt ?? true)) {
        const waveStart = started;
        const waveSize = Math.min(this.maxInFlightAttempts, total - started);
        started += waveSize;
        await options.onProgress(snapshot());

        await Promise.all(Array.from({ length: waveSize }, (_unused, offset) => executeAttempt(waveStart + offset)));
        await options.onProgress(snapshot());
        continue;
      }

      const wave: Array<Promise<void>> = [];
      const firstIndex = started;
      started += 1;
      await options.onProgress(snapshot());

      const firstAttempt = executeAttempt(firstIndex);
      wave.push(firstAttempt);

      // Give an immediately-resolved quota failure a chance to stop the wave
      // before we fan out more attempts. Slower attempts still fill the window.
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));

      if (!stoppedEarly && started < total) {
        const restCount = Math.min(this.maxInFlightAttempts - 1, total - started);
        if (restCount > 0) {
          const restStart = started;
          started += restCount;
          await options.onProgress(snapshot());

          for (let offset = 0; offset < restCount; offset += 1) {
            wave.push(executeAttempt(restStart + offset));
          }
        }
      }

      await Promise.all(wave);
      await options.onProgress(snapshot());
    }

    return {
      ...snapshot(),
      ...(stoppedEarly ? { stoppedEarly: true as const, stopReason } : {})
    };
  }
}

function normalizePositiveInteger(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

function compactResults(resultsByIndex: Array<RegistrationResult | undefined>): RegistrationResult[] {
  return resultsByIndex.filter((result): result is RegistrationResult => result !== undefined);
}
