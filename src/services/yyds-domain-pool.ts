import {
  normalizeDomain,
  type YydsDomainHealthRecord,
  type YydsDomainHealthStatus,
  type YydsDomainPoolConfig,
  type YydsDomainPoolStore
} from "../store/yyds-domain-pool-store.js";

export type YydsFailureKind = "verification_timeout" | "rate_limited" | "quota_exhausted" | "other";

export interface YydsDomainCandidate {
  domain: string;
  status: YydsDomainHealthStatus;
  weight: number;
  successCount: number;
  failureCount: number;
  verificationTimeoutCount: number;
  mailboxRateLimitCount: number;
  quotaExhaustedCount: number;
  lastSuccessAt: number;
  lastFailureAt: number;
  cooldownUntil: number;
  lastCheckedAt: number;
  lastError?: string;
}

export interface YydsFetchedDomain {
  domain: string;
  isPublic?: boolean;
  isVerified?: boolean;
  isMxValid?: boolean;
  dnsRecords?: {
    receivingReady?: boolean;
    status?: string;
  };
}

export interface YydsDomainPoolOptions {
  store: YydsDomainPoolStore;
  fetchDomains: () => Promise<YydsFetchedDomain[]>;
  now?: () => number;
}

const DEFAULT_WEIGHT = 100;
const WHITELIST_WEIGHT = 110;
const COOLDOWN_MS = 10 * 60 * 1000;

export class YydsDomainPool {
  private readonly store: YydsDomainPoolStore;
  private readonly fetchDomains: () => Promise<YydsFetchedDomain[]>;
  private readonly now: () => number;
  private autoEligibleDomains = new Set<string>();
  private hasAutoRefreshSnapshot = false;

  constructor(options: YydsDomainPoolOptions) {
    this.store = options.store;
    this.fetchDomains = options.fetchDomains;
    this.now = options.now ?? Date.now;
  }

  async refresh(): Promise<{ eligible: Array<{ domain: string }> }> {
    const config = normalizeConfig(await this.store.getConfig());
    if (!config.enabled) {
      return { eligible: [] };
    }

    const blacklist = new Set(config.blacklist.map(normalizeDomain));
    const fetched = await this.fetchDomains();
    const eligibleDomains = fetched
      .filter(isHealthyReceivingDomain)
      .map((item) => normalizeDomain(item.domain))
      .filter((domain) => domain && !blacklist.has(domain));

    const uniqueDomains = Array.from(new Set(eligibleDomains));
    this.autoEligibleDomains = new Set(uniqueDomains);
    this.hasAutoRefreshSnapshot = true;
    for (const domain of uniqueDomains) {
      await this.ensureHealth(domain, this.now(), config.whitelist.includes(domain) ? WHITELIST_WEIGHT : DEFAULT_WEIGHT);
    }

    return { eligible: uniqueDomains.map((domain) => ({ domain })) };
  }

  async listCandidates(): Promise<YydsDomainCandidate[]> {
    const config = normalizeConfig(await this.store.getConfig());
    if (!config.enabled) {
      return [];
    }

    const blacklist = new Set(config.blacklist.map(normalizeDomain));
    const healthByDomain = new Map(
      (await this.store.listHealth()).map((record) => {
        const domain = normalizeDomain(record.domain);
        return [domain, { ...record, domain }] as const;
      })
    );
    const domains = new Set<string>();

    if (config.mode === "auto" || config.mode === "auto-plus-whitelist") {
      if (this.hasAutoRefreshSnapshot) {
        for (const domain of this.autoEligibleDomains) {
          domains.add(domain);
        }
      } else {
        for (const record of healthByDomain.values()) {
          if (isFreshPersistedAutoHealth(record, config, this.now())) {
            domains.add(record.domain);
          }
        }
      }
    }
    if (config.mode === "whitelist" || config.mode === "auto-plus-whitelist") {
      for (const domain of config.whitelist) {
        domains.add(domain);
      }
    }

    const candidates: YydsDomainCandidate[] = [];
    for (const domain of domains) {
      if (!domain || blacklist.has(domain)) {
        continue;
      }

      const base = healthByDomain.get(domain) ?? defaultHealth(domain, 0, config.whitelist.includes(domain) ? WHITELIST_WEIGHT : DEFAULT_WEIGHT);
      const record = await this.normalizeCooldown(base);
      candidates.push(toCandidate(record));
    }

    return candidates.sort((a, b) => b.weight - a.weight || a.domain.localeCompare(b.domain));
  }

  async pickDomain(): Promise<YydsDomainCandidate | undefined> {
    const candidates = await this.listCandidates();
    return candidates.find((candidate) => candidate.status === "active");
  }

  async recordSuccess(domain: string): Promise<void> {
    const now = this.now();
    const record = await this.getOrCreateHealth(domain, now);
    const disabled = record.status === "disabled";
    await this.store.saveHealth({
      ...record,
      status: disabled ? "disabled" : "active",
      successCount: record.successCount + 1,
      lastSuccessAt: now,
      cooldownUntil: disabled ? record.cooldownUntil : 0,
      weight: Math.max(DEFAULT_WEIGHT, record.weight + 1),
      lastCheckedAt: now,
      lastError: undefined
    });
  }

  async recordFailure(domain: string, kind: YydsFailureKind, error: string): Promise<void> {
    const now = this.now();
    const record = await this.getOrCreateHealth(domain, now);
    const verificationTimeoutCount = record.verificationTimeoutCount + (kind === "verification_timeout" ? 1 : 0);
    const disabled = record.status === "disabled";
    const cooldown = !disabled && kind === "verification_timeout" && verificationTimeoutCount >= 2;

    await this.store.saveHealth({
      ...record,
      status: disabled ? "disabled" : cooldown ? "cooldown" : record.status,
      failureCount: record.failureCount + 1,
      verificationTimeoutCount,
      mailboxRateLimitCount: record.mailboxRateLimitCount + (kind === "rate_limited" ? 1 : 0),
      quotaExhaustedCount: record.quotaExhaustedCount + (kind === "quota_exhausted" ? 1 : 0),
      lastFailureAt: now,
      cooldownUntil: disabled ? record.cooldownUntil : cooldown ? now + COOLDOWN_MS : record.cooldownUntil,
      weight: Math.max(1, record.weight - 10),
      lastCheckedAt: now,
      lastError: error
    });
  }

  private async ensureHealth(domain: string, now: number, weight: number): Promise<YydsDomainHealthRecord> {
    const normalized = normalizeDomain(domain);
    const existing = await this.findHealthByNormalizedDomain(normalized);
    const record = existing
      ? { ...existing, weight: Math.max(existing.weight, weight), lastCheckedAt: now }
      : defaultHealth(normalized, now, weight);
    await this.store.saveHealth(record);
    return record;
  }

  private async getOrCreateHealth(domain: string, now: number): Promise<YydsDomainHealthRecord> {
    const normalized = normalizeDomain(domain);
    return (await this.findHealthByNormalizedDomain(normalized)) ?? defaultHealth(normalized, now, DEFAULT_WEIGHT);
  }

  private async findHealthByNormalizedDomain(normalized: string): Promise<YydsDomainHealthRecord | undefined> {
    const exact = await this.store.getHealth(normalized);
    if (exact) {
      return { ...exact, domain: normalized };
    }

    const fallback = (await this.store.listHealth()).find((record) => normalizeDomain(record.domain) === normalized);
    return fallback ? { ...fallback, domain: normalized } : undefined;
  }

  private async normalizeCooldown(record: YydsDomainHealthRecord): Promise<YydsDomainHealthRecord> {
    if (record.status !== "cooldown" || record.cooldownUntil > this.now()) {
      return record;
    }

    const active = {
      ...record,
      status: "active" as const,
      cooldownUntil: 0
    };
    await this.store.saveHealth(active);
    return active;
  }
}

function isHealthyReceivingDomain(domain: YydsFetchedDomain): boolean {
  return (
    Boolean(normalizeDomain(domain.domain)) &&
    domain.isPublic === true &&
    domain.isVerified === true &&
    domain.isMxValid === true &&
    domain.dnsRecords?.receivingReady === true &&
    domain.dnsRecords.status === "healthy"
  );
}

function defaultHealth(domain: string, now: number, weight: number): YydsDomainHealthRecord {
  return {
    domain: normalizeDomain(domain),
    status: "active",
    successCount: 0,
    failureCount: 0,
    verificationTimeoutCount: 0,
    mailboxRateLimitCount: 0,
    quotaExhaustedCount: 0,
    lastSuccessAt: 0,
    lastFailureAt: 0,
    cooldownUntil: 0,
    weight,
    lastCheckedAt: now
  };
}

function normalizeConfig(config: YydsDomainPoolConfig): YydsDomainPoolConfig {
  return {
    ...config,
    whitelist: config.whitelist.map(normalizeDomain).filter(Boolean),
    blacklist: config.blacklist.map(normalizeDomain).filter(Boolean)
  };
}

function isFreshPersistedAutoHealth(
  record: YydsDomainHealthRecord,
  config: YydsDomainPoolConfig,
  now: number
): boolean {
  if (record.status === "disabled" || record.lastCheckedAt <= 0) {
    return false;
  }
  return now - record.lastCheckedAt <= config.refreshIntervalMinutes * 60 * 1000;
}

function toCandidate(record: YydsDomainHealthRecord): YydsDomainCandidate {
  return { ...record };
}
