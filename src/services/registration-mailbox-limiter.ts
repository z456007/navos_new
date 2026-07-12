export interface RegistrationMailboxLimiterRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, nx: "NX", px: "PX", ttlMs: number): Promise<"OK" | null>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  pttl(key: string): Promise<number>;
}

export interface RegistrationMailboxLimiterOptions {
  redis: RegistrationMailboxLimiterRedis;
  keyPrefix: string;
  concurrency: number;
  perSecond: number;
  quotaBlockSeconds?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class RedisRegistrationMailboxLimiter {
  private readonly redis: RegistrationMailboxLimiterRedis;
  private readonly keyPrefix: string;
  private readonly concurrency: number;
  private readonly minIntervalMs: number;
  private readonly quotaBlockSeconds: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: RegistrationMailboxLimiterOptions) {
    this.redis = options.redis;
    this.keyPrefix = options.keyPrefix.replace(/:+$/, "");
    this.concurrency = Math.max(1, Math.trunc(options.concurrency));
    this.minIntervalMs = Math.ceil(1000 / Math.max(1, Math.trunc(options.perSecond)));
    this.quotaBlockSeconds = Math.max(1, Math.trunc(options.quotaBlockSeconds ?? 300));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.assertQuotaOpen();
    await this.acquireSlot();
    try {
      await this.acquireQpsGate();
      return await work();
    } finally {
      await this.redis.decr(this.inflightKey());
    }
  }

  async blockQuota(seconds: number = this.quotaBlockSeconds): Promise<void> {
    const ttlSeconds = Math.max(1, Math.trunc(seconds));
    await this.redis.set(this.quotaKey(), String(Date.now() + ttlSeconds * 1000), "NX", "PX", ttlSeconds * 1000);
  }

  private async assertQuotaOpen(): Promise<void> {
    const blockedUntil = await this.redis.get(this.quotaKey());
    if (blockedUntil) {
      throw new Error("YYDS mailbox quota exhausted; registration is temporarily paused");
    }
  }

  private async acquireSlot(): Promise<void> {
    while (true) {
      await this.assertQuotaOpen();
      const count = await this.redis.incr(this.inflightKey());
      await this.redis.expire(this.inflightKey(), 60);
      if (count <= this.concurrency) return;
      await this.redis.decr(this.inflightKey());
      await this.sleep(100);
    }
  }

  private async acquireQpsGate(): Promise<void> {
    while (true) {
      const acquired = await this.redis.set(this.qpsKey(), String(Date.now()), "NX", "PX", this.minIntervalMs);
      if (acquired === "OK") return;
      const ttl = await this.redis.pttl(this.qpsKey());
      await this.sleep(ttl > 0 ? ttl : this.minIntervalMs);
    }
  }

  private inflightKey(): string {
    return `${this.keyPrefix}:registration:mailbox:create:inflight`;
  }

  private qpsKey(): string {
    return `${this.keyPrefix}:registration:mailbox:create:qps`;
  }

  private quotaKey(): string {
    return `${this.keyPrefix}:registration:yyds:quota_exhausted_until`;
  }
}
