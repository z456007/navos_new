import {
  normalizeDomain,
  type YydsDomainHealthRecord,
  type YydsDomainHealthStatus,
  type YydsDomainPoolConfig,
  type YydsDomainPoolMode,
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
  lastAutoCheckedAt: number;
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
export const YYDS_DOMAIN_POOL_MAX_DOMAINS = 500;
export const YYDS_DOMAIN_POOL_MAX_REFRESH_INTERVAL_MINUTES = 1440;

export const DEFAULT_YYDS_DOMAIN_POOL_CONFIG: YydsDomainPoolConfig = {
  enabled: true,
  mode: "auto-plus-whitelist",
  whitelist: [],
  blacklist: [],
  refreshIntervalMinutes: 30
};

const DOMAIN_POOL_CONFIG_KEYS = new Set([
  "enabled",
  "mode",
  "whitelist",
  "blacklist",
  "refreshIntervalMinutes"
]);

export class YydsDomainPoolConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YydsDomainPoolConfigValidationError";
  }
}

export class YydsDomainPoolSourceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YydsDomainPoolSourceValidationError";
  }
}

export function normalizeYydsDomainPoolConfig(config: YydsDomainPoolConfig): YydsDomainPoolConfig {
  return normalizeYydsDomainPoolConfigInput(config, DEFAULT_YYDS_DOMAIN_POOL_CONFIG);
}

export function normalizeYydsDomainPoolConfigInput(
  body: unknown,
  current: YydsDomainPoolConfig
): YydsDomainPoolConfig {
  assertYydsDomainPoolConfigInput(body);
  return {
    enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
    mode: parseYydsDomainPoolMode(body.mode) ?? current.mode,
    whitelist: Array.isArray(body.whitelist) ? normalizeYydsDomainStringList(body.whitelist) : current.whitelist,
    blacklist: Array.isArray(body.blacklist) ? normalizeYydsDomainStringList(body.blacklist) : current.blacklist,
    refreshIntervalMinutes: parsePositiveInteger(body.refreshIntervalMinutes) ?? current.refreshIntervalMinutes
  };
}

export function assertYydsDomainPoolConfigInput(body: unknown): asserts body is Record<string, unknown> {
  if (!isPlainRecordValue(body)) {
    throw new YydsDomainPoolConfigValidationError("config body must be an object");
  }
  for (const key of Object.keys(body)) {
    if (!DOMAIN_POOL_CONFIG_KEYS.has(key)) {
      throw new YydsDomainPoolConfigValidationError(`Unknown domain pool config field: ${key}`);
    }
  }
  if ("enabled" in body && typeof body.enabled !== "boolean") {
    throw new YydsDomainPoolConfigValidationError("enabled must be a boolean");
  }
  if ("mode" in body && parseYydsDomainPoolMode(body.mode) === undefined) {
    throw new YydsDomainPoolConfigValidationError("mode must be auto, whitelist, or auto-plus-whitelist");
  }
  if ("refreshIntervalMinutes" in body) {
    const refreshIntervalMinutes = parsePositiveInteger(body.refreshIntervalMinutes);
    if (
      refreshIntervalMinutes === undefined
      || refreshIntervalMinutes > YYDS_DOMAIN_POOL_MAX_REFRESH_INTERVAL_MINUTES
    ) {
      throw new YydsDomainPoolConfigValidationError(
        `refreshIntervalMinutes must be a positive integer no greater than ${YYDS_DOMAIN_POOL_MAX_REFRESH_INTERVAL_MINUTES}`
      );
    }
  }
  for (const key of ["whitelist", "blacklist"] as const) {
    if (!(key in body)) {
      continue;
    }
    const value = body[key];
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      throw new YydsDomainPoolConfigValidationError(`${key} must be a string array`);
    }
    if (value.length > YYDS_DOMAIN_POOL_MAX_DOMAINS) {
      throw new YydsDomainPoolConfigValidationError(`${key} must contain no more than ${YYDS_DOMAIN_POOL_MAX_DOMAINS} domains`);
    }
    for (const domain of value) {
      if (!isValidYydsDomainPoolDomain(domain)) {
        throw new YydsDomainPoolConfigValidationError(`${key} contains an invalid domain`);
      }
    }
  }
}

export function normalizeYydsDomainStringList(value: string[]): string[] {
  return Array.from(new Set(
    value
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  ));
}

export function isValidYydsDomainPoolDomain(value: string): boolean {
  const domain = value.trim().toLowerCase();
  if (!domain || domain.length > 253 || domain.includes("..")) {
    return false;
  }
  const labels = domain.split(".");
  if (labels.length < 2) {
    return false;
  }
  return labels.every((label) => (
    label.length >= 1
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ));
}

function parseYydsDomainPoolMode(value: unknown): YydsDomainPoolMode | undefined {
  return value === "auto" || value === "whitelist" || value === "auto-plus-whitelist" ? value : undefined;
}

function parsePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function isPlainRecordValue(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

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
    if (fetched.length > YYDS_DOMAIN_POOL_MAX_DOMAINS) {
      throw new YydsDomainPoolSourceValidationError(
        `YYDS domain refresh returned more than ${YYDS_DOMAIN_POOL_MAX_DOMAINS} domains`
      );
    }
    const eligibleDomains = fetched
      .filter(isHealthyReceivingDomain)
      .map((item) => normalizeDomain(item.domain))
      .filter((domain) => domain && !blacklist.has(domain));

    const uniqueDomains = Array.from(new Set(eligibleDomains));
    if (uniqueDomains.length > YYDS_DOMAIN_POOL_MAX_DOMAINS) {
      throw new YydsDomainPoolSourceValidationError(
        `YYDS domain refresh produced more than ${YYDS_DOMAIN_POOL_MAX_DOMAINS} eligible domains`
      );
    }
    const now = this.now();
    const uniqueDomainSet = new Set(uniqueDomains);
    const healthByDomain = new Map(
      (await this.store.listHealth()).map((record) => {
        const domain = normalizeDomain(record.domain);
        return [domain, { ...record, domain }] as const;
      })
    );
    const nextRecords = uniqueDomains.map((domain) => {
      const weight = config.whitelist.includes(domain) ? WHITELIST_WEIGHT : DEFAULT_WEIGHT;
      const existing = healthByDomain.get(domain);
      return existing
        ? { ...existing, weight: Math.max(existing.weight, weight), lastCheckedAt: now, lastAutoCheckedAt: now }
        : { ...defaultHealth(domain, now, weight), lastAutoCheckedAt: now };
    });

    await this.store.replaceAutoSnapshot(nextRecords);
    this.autoEligibleDomains = uniqueDomainSet;
    this.hasAutoRefreshSnapshot = true;

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
          const record = healthByDomain.get(domain);
          if (record && isFreshPersistedAutoHealth(record, config, this.now())) {
            domains.add(domain);
          }
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
    isValidYydsDomainPoolDomain(domain.domain) &&
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
    lastCheckedAt: now,
    lastAutoCheckedAt: 0
  };
}

function normalizeConfig(config: YydsDomainPoolConfig): YydsDomainPoolConfig {
  return {
    ...config,
    whitelist: config.whitelist.map(normalizeDomain).filter(isValidYydsDomainPoolDomain),
    blacklist: config.blacklist.map(normalizeDomain).filter(isValidYydsDomainPoolDomain)
  };
}

function isFreshPersistedAutoHealth(
  record: YydsDomainHealthRecord,
  config: YydsDomainPoolConfig,
  now: number
): boolean {
  if (record.status === "disabled" || record.lastAutoCheckedAt <= 0) {
    return false;
  }
  return now - record.lastAutoCheckedAt <= config.refreshIntervalMinutes * 60 * 1000;
}

function toCandidate(record: YydsDomainHealthRecord): YydsDomainCandidate {
  return { ...record };
}
