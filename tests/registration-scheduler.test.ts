import { describe, expect, it, vi } from "vitest";
import { RegistrationScheduler } from "../src/services/registration-scheduler.js";

describe("RegistrationScheduler", () => {
  it("runs attempts up to maxInFlight without the old global cap of 2", async () => {
    let active = 0;
    let maxActive = 0;
    const scheduler = new RegistrationScheduler({ maxInFlightAttempts: 4 });
    const result = await scheduler.run({
      planned: 4,
      runAttempt: vi.fn(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { success: true };
      }),
      onProgress: async () => undefined
    });
    expect(maxActive).toBe(4);
    expect(result).toMatchObject({ started: 4, completed: 4, failed: 0 });
  });

  it("stops scheduling new attempts on quota exhausted failures", async () => {
    const scheduler = new RegistrationScheduler({ maxInFlightAttempts: 2 });
    const result = await scheduler.run({
      planned: 5,
      runAttempt: vi.fn(async () => ({ success: false, error: "quota exhausted", failureKind: "quota_exhausted" })),
      onProgress: async () => undefined
    });
    expect(result).toMatchObject({
      started: 1,
      completed: 0,
      failed: 1,
      stoppedEarly: true,
      stopReason: "quota_exhausted"
    });
  });
});
