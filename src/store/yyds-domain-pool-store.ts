export type YydsDomainPoolMode = "auto" | "whitelist" | "auto-plus-whitelist";
export type YydsDomainHealthStatus = "active" | "cooldown" | "disabled";

export interface YydsDomainPoolConfig {
  enabled: boolean;
  mode: YydsDomainPoolMode;
  whitelist: string[];
  blacklist: string[];
  refreshIntervalMinutes: number;
}

export interface YydsDomainHealthRecord {
  domain: string;
  status: YydsDomainHealthStatus;
  successCount: number;
  failureCount: number;
  verificationTimeoutCount: number;
  mailboxRateLimitCount: number;
  quotaExhaustedCount: number;
  lastSuccessAt: number;
  lastFailureAt: number;
  cooldownUntil: number;
  weight: number;
  lastCheckedAt: number;
  lastError?: string;
}

export interface YydsDomainPoolStore {
  getConfig(): Promise<YydsDomainPoolConfig>;
  saveConfig(config: YydsDomainPoolConfig): Promise<void>;
  listHealth(): Promise<YydsDomainHealthRecord[]>;
  getHealth(domain: string): Promise<YydsDomainHealthRecord | undefined>;
  saveHealth(record: YydsDomainHealthRecord): Promise<void>;
}

const DEFAULT_CONFIG: YydsDomainPoolConfig = {
  enabled: true,
  mode: "auto",
  whitelist: [],
  blacklist: [],
  refreshIntervalMinutes: 30
};

export class InMemoryYydsDomainPoolStore implements YydsDomainPoolStore {
  private config: YydsDomainPoolConfig = { ...DEFAULT_CONFIG };
  private readonly health = new Map<string, YydsDomainHealthRecord>();

  async getConfig(): Promise<YydsDomainPoolConfig> {
    return cloneConfig(this.config);
  }

  async saveConfig(config: YydsDomainPoolConfig): Promise<void> {
    this.config = cloneConfig(config);
  }

  async listHealth(): Promise<YydsDomainHealthRecord[]> {
    return Array.from(this.health.values()).map(cloneHealth);
  }

  async getHealth(domain: string): Promise<YydsDomainHealthRecord | undefined> {
    const record = this.health.get(normalizeDomain(domain));
    return record ? cloneHealth(record) : undefined;
  }

  async saveHealth(record: YydsDomainHealthRecord): Promise<void> {
    const normalized = cloneHealth(record);
    this.health.set(normalized.domain, normalized);
  }
}

export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

function cloneConfig(config: YydsDomainPoolConfig): YydsDomainPoolConfig {
  return {
    ...config,
    whitelist: config.whitelist.map(normalizeDomain).filter(Boolean),
    blacklist: config.blacklist.map(normalizeDomain).filter(Boolean)
  };
}

function cloneHealth(record: YydsDomainHealthRecord): YydsDomainHealthRecord {
  return {
    ...record,
    domain: normalizeDomain(record.domain)
  };
}
