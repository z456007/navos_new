import type { RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";
import mysql from "mysql2/promise";
import type { MysqlConfig } from "./mysql-account-store.js";

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
  ensureSchema?(): Promise<void>;
  hasConfig?(): Promise<boolean>;
  getConfig(): Promise<YydsDomainPoolConfig>;
  saveConfig(config: YydsDomainPoolConfig): Promise<void>;
  listHealth(): Promise<YydsDomainHealthRecord[]>;
  getHealth(domain: string): Promise<YydsDomainHealthRecord | undefined>;
  saveHealth(record: YydsDomainHealthRecord): Promise<void>;
}

const DEFAULT_CONFIG: YydsDomainPoolConfig = {
  enabled: true,
  mode: "auto-plus-whitelist",
  whitelist: [],
  blacklist: [],
  refreshIntervalMinutes: 30
};
const DEFAULT_HEALTH_WEIGHT = 10;

interface YydsDomainPoolConfigRow extends RowDataPacket {
  enabled: 0 | 1;
  mode: string;
  whitelist_json: unknown;
  blacklist_json: unknown;
  refresh_interval_minutes: number;
}

interface YydsDomainHealthRow extends RowDataPacket {
  domain: string;
  status: string;
  success_count: number;
  failure_count: number;
  verification_timeout_count: number;
  mailbox_rate_limit_count: number;
  quota_exhausted_count: number;
  last_success_at: number;
  last_failure_at: number;
  cooldown_until: number;
  weight: number;
  last_checked_at: number;
  last_error: string | null;
}

export class InMemoryYydsDomainPoolStore implements YydsDomainPoolStore {
  private config: YydsDomainPoolConfig = { ...DEFAULT_CONFIG };
  private readonly health = new Map<string, YydsDomainHealthRecord>();

  async getConfig(): Promise<YydsDomainPoolConfig> {
    return cloneConfig(this.config);
  }

  async hasConfig(): Promise<boolean> {
    return true;
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

export class MysqlYydsDomainPoolStore implements YydsDomainPoolStore {
  private readonly pool: Pool;

  constructor(config: MysqlConfig) {
    this.pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true
    });
  }

  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS yyds_domain_pool_config (
        id TINYINT PRIMARY KEY,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        mode VARCHAR(32) NOT NULL DEFAULT 'auto-plus-whitelist',
        whitelist_json JSON NOT NULL,
        blacklist_json JSON NOT NULL,
        refresh_interval_minutes INT NOT NULL DEFAULT 30,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS yyds_domain_health (
        domain VARCHAR(255) PRIMARY KEY,
        status ENUM('active', 'cooldown', 'disabled') NOT NULL DEFAULT 'active',
        success_count INT NOT NULL DEFAULT 0,
        failure_count INT NOT NULL DEFAULT 0,
        verification_timeout_count INT NOT NULL DEFAULT 0,
        mailbox_rate_limit_count INT NOT NULL DEFAULT 0,
        quota_exhausted_count INT NOT NULL DEFAULT 0,
        last_success_at BIGINT NOT NULL DEFAULT 0,
        last_failure_at BIGINT NOT NULL DEFAULT 0,
        cooldown_until BIGINT NOT NULL DEFAULT 0,
        weight INT NOT NULL DEFAULT 10,
        last_checked_at BIGINT NOT NULL DEFAULT 0,
        last_error TEXT NULL
      )
    `);
  }

  async getConfig(): Promise<YydsDomainPoolConfig> {
    const [rows] = await this.pool.execute<YydsDomainPoolConfigRow[]>(
      "SELECT enabled, mode, whitelist_json, blacklist_json, refresh_interval_minutes FROM yyds_domain_pool_config WHERE id = 1 LIMIT 1"
    );
    return rows[0] ? configFromRow(rows[0]) : cloneConfig(DEFAULT_CONFIG);
  }

  async hasConfig(): Promise<boolean> {
    const [rows] = await this.pool.execute<Array<RowDataPacket & { config_exists: number }>>(
      "SELECT COUNT(*) AS config_exists FROM yyds_domain_pool_config WHERE id = 1"
    );
    return Number(rows[0]?.config_exists ?? 0) > 0;
  }

  async saveConfig(config: YydsDomainPoolConfig): Promise<void> {
    const normalized = cloneConfig(config);
    const now = Date.now();
    await this.pool.execute(
      `INSERT INTO yyds_domain_pool_config
        (id, enabled, mode, whitelist_json, blacklist_json, refresh_interval_minutes, created_at, updated_at)
       VALUES
        (1, :enabled, :mode, :whitelistJson, :blacklistJson, :refreshIntervalMinutes, :now, :now)
       ON DUPLICATE KEY UPDATE
        enabled = VALUES(enabled),
        mode = VALUES(mode),
        whitelist_json = VALUES(whitelist_json),
        blacklist_json = VALUES(blacklist_json),
        refresh_interval_minutes = VALUES(refresh_interval_minutes),
        updated_at = VALUES(updated_at)`,
      {
        enabled: normalized.enabled ? 1 : 0,
        mode: normalized.mode,
        whitelistJson: JSON.stringify(normalized.whitelist),
        blacklistJson: JSON.stringify(normalized.blacklist),
        refreshIntervalMinutes: normalized.refreshIntervalMinutes,
        now
      }
    );
  }

  async listHealth(): Promise<YydsDomainHealthRecord[]> {
    const [rows] = await this.pool.query<YydsDomainHealthRow[]>("SELECT * FROM yyds_domain_health ORDER BY domain ASC");
    return rows.map(healthFromRow);
  }

  async getHealth(domain: string): Promise<YydsDomainHealthRecord | undefined> {
    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedDomain) {
      return undefined;
    }
    const [rows] = await this.pool.execute<YydsDomainHealthRow[]>("SELECT * FROM yyds_domain_health WHERE domain = :domain LIMIT 1", {
      domain: normalizedDomain
    });
    return rows[0] ? healthFromRow(rows[0]) : undefined;
  }

  async saveHealth(record: YydsDomainHealthRecord): Promise<void> {
    const normalized = cloneHealth(record);
    await this.pool.execute(
      `INSERT INTO yyds_domain_health
        (domain, status, success_count, failure_count, verification_timeout_count, mailbox_rate_limit_count,
         quota_exhausted_count, last_success_at, last_failure_at, cooldown_until, weight, last_checked_at, last_error)
       VALUES
        (:domain, :status, :successCount, :failureCount, :verificationTimeoutCount, :mailboxRateLimitCount,
         :quotaExhaustedCount, :lastSuccessAt, :lastFailureAt, :cooldownUntil, :weight, :lastCheckedAt, :lastError)
       ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        success_count = VALUES(success_count),
        failure_count = VALUES(failure_count),
        verification_timeout_count = VALUES(verification_timeout_count),
        mailbox_rate_limit_count = VALUES(mailbox_rate_limit_count),
        quota_exhausted_count = VALUES(quota_exhausted_count),
        last_success_at = VALUES(last_success_at),
        last_failure_at = VALUES(last_failure_at),
        cooldown_until = VALUES(cooldown_until),
        weight = VALUES(weight),
        last_checked_at = VALUES(last_checked_at),
        last_error = VALUES(last_error)`,
      {
        domain: normalized.domain,
        status: normalized.status,
        successCount: normalized.successCount,
        failureCount: normalized.failureCount,
        verificationTimeoutCount: normalized.verificationTimeoutCount,
        mailboxRateLimitCount: normalized.mailboxRateLimitCount,
        quotaExhaustedCount: normalized.quotaExhaustedCount,
        lastSuccessAt: normalized.lastSuccessAt,
        lastFailureAt: normalized.lastFailureAt,
        cooldownUntil: normalized.cooldownUntil,
        weight: normalized.weight,
        lastCheckedAt: normalized.lastCheckedAt,
        lastError: normalized.lastError ?? null
      }
    );
  }
}

export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

function cloneConfig(config: YydsDomainPoolConfig): YydsDomainPoolConfig {
  const refreshIntervalMinutes = Number(config.refreshIntervalMinutes);
  return {
    ...config,
    mode: parseMode(config.mode),
    whitelist: config.whitelist.map(normalizeDomain).filter(Boolean),
    blacklist: config.blacklist.map(normalizeDomain).filter(Boolean),
    refreshIntervalMinutes: Number.isInteger(refreshIntervalMinutes) && refreshIntervalMinutes > 0
      ? refreshIntervalMinutes
      : DEFAULT_CONFIG.refreshIntervalMinutes
  };
}

function cloneHealth(record: YydsDomainHealthRecord): YydsDomainHealthRecord {
  const domain = normalizeDomain(record.domain);
  if (!domain) {
    throw new Error("YYDS domain health domain must not be empty");
  }
  const cloned: YydsDomainHealthRecord = {
    ...record,
    domain,
    status: parseStatus(record.status),
    successCount: parseNonNegativeInteger(record.successCount, 0),
    failureCount: parseNonNegativeInteger(record.failureCount, 0),
    verificationTimeoutCount: parseNonNegativeInteger(record.verificationTimeoutCount, 0),
    mailboxRateLimitCount: parseNonNegativeInteger(record.mailboxRateLimitCount, 0),
    quotaExhaustedCount: parseNonNegativeInteger(record.quotaExhaustedCount, 0),
    lastSuccessAt: parseNonNegativeInteger(record.lastSuccessAt, 0),
    lastFailureAt: parseNonNegativeInteger(record.lastFailureAt, 0),
    cooldownUntil: parseNonNegativeInteger(record.cooldownUntil, 0),
    weight: parsePositiveInteger(record.weight, DEFAULT_HEALTH_WEIGHT),
    lastCheckedAt: parseNonNegativeInteger(record.lastCheckedAt, 0)
  };
  if (cloned.lastError === undefined) {
    delete cloned.lastError;
  }
  return cloned;
}

function configFromRow(row: YydsDomainPoolConfigRow): YydsDomainPoolConfig {
  return cloneConfig({
    enabled: row.enabled === 1,
    mode: parseMode(row.mode),
    whitelist: parseJsonList(row.whitelist_json),
    blacklist: parseJsonList(row.blacklist_json),
    refreshIntervalMinutes: Number(row.refresh_interval_minutes) || DEFAULT_CONFIG.refreshIntervalMinutes
  });
}

function healthFromRow(row: YydsDomainHealthRow): YydsDomainHealthRecord {
  return cloneHealth({
    domain: row.domain,
    status: row.status as YydsDomainHealthStatus,
    successCount: Number(row.success_count),
    failureCount: Number(row.failure_count),
    verificationTimeoutCount: Number(row.verification_timeout_count),
    mailboxRateLimitCount: Number(row.mailbox_rate_limit_count),
    quotaExhaustedCount: Number(row.quota_exhausted_count),
    lastSuccessAt: Number(row.last_success_at),
    lastFailureAt: Number(row.last_failure_at),
    cooldownUntil: Number(row.cooldown_until),
    weight: Number(row.weight),
    lastCheckedAt: Number(row.last_checked_at),
    lastError: row.last_error ?? undefined
  });
}

function parseMode(value: string): YydsDomainPoolMode {
  if (value === "auto" || value === "whitelist" || value === "auto-plus-whitelist") {
    return value;
  }
  return DEFAULT_CONFIG.mode;
}

function parseStatus(value: string): YydsDomainHealthStatus {
  if (value === "active" || value === "cooldown" || value === "disabled") {
    return value;
  }
  return "active";
}

function parseNonNegativeInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function parsePositiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 1 ? value : fallback;
}

function parseJsonList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (Buffer.isBuffer(value)) {
    return parseJsonList(value.toString("utf8"));
  }
  if (typeof value === "string") {
    try {
      return parseJsonList(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}
