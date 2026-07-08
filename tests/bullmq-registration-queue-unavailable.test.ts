import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { BullmqRegistrationQueue } from "../src/services/bullmq-registration-queue.js";
import { RegistrationQueueUnavailableError } from "../src/services/registration-job-service.js";

describe("BullmqRegistrationQueue unavailable Redis behavior", () => {
  let queue: BullmqRegistrationQueue | undefined;

  afterEach(async () => {
    if (queue) {
      await queue.close().catch(() => undefined);
      queue = undefined;
    }
  });

  it("fails add within a bounded time when Redis is unreachable", async () => {
    queue = new BullmqRegistrationQueue({
      redisUrl: "redis://127.0.0.1:1",
      queuePrefix: `navos-unavailable-${Date.now()}`,
      removeOnComplete: 1,
      removeOnFail: 1
    });

    const startedAt = performance.now();

    await expect(queue.add({ mode: "single" })).rejects.toBeInstanceOf(RegistrationQueueUnavailableError);
    expect(performance.now() - startedAt).toBeLessThan(4_000);
  }, 6_000);
});
