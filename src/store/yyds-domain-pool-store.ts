import type { RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";
import type { YydsFailureKind } from "../protocols/mail/yyds-mail.js";
import { createMysqlPool, type MysqlConfig } from "./mysql-config.js";

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
  lastAutoCheckedAt: number;
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
  recordSuccess?(domain: string, now: number): Promise<void>;
  recordFailure?(domain: string, kind: YydsFailureKind, error: string, now: number): Promise<void>;
  replaceAutoSnapshot(records: YydsDomainHealthRecord[]): Promise<void>;
}

const DEFAULT_CONFIG: YydsDomainPoolConfig = {
  enabled: true,
  mode: "auto-plus-whitelist",
  whitelist: [],
  blacklist: [],
  refreshIntervalMinutes: 30
};
const DEFAULT_HEALTH_WEIGHT = 10;
const DOMAIN_POOL_HEALTH_WEIGHT = 100;
const HEALTH_COOLDOWN_MS = 10 * 60 * 1000;

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
  last_auto_checked_at?: number;
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

  async recordSuccess(domain: string, now: number): Promise<void> {
    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedDomain) {
      throw new Error("YYDS domain health domain must not be empty");
    }
    const record = this.health.get(normalizedDomain) ?? defaultHealthRecord(normalizedDomain, now);
    const disabled = record.status === "disabled";
    this.health.set(normalizedDomain, cloneHealth({
      ...record,
      status: disabled ? "disabled" : "active",
      successCount: record.successCount + 1,
      lastSuccessAt: now,
      cooldownUntil: disabled ? record.cooldownUntil : 0,
      weight: Math.max(DOMAIN_POOL_HEALTH_WEIGHT, record.weight + 1),
      lastCheckedAt: now,
      lastError: undefined
    }));
  }

  async recordFailure(domain: string, kind: YydsFailureKind, error: string, now: number): Promise<void> {
    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedDomain) {
      throw new Error("YYDS domain health domain must not be empty");
    }
    const record = this.health.get(normalizedDomain) ?? defaultHealthRecord(normalizedDomain, now);
    const verificationTimeoutCount = record.verificationTimeoutCount + (kind === "verification_timeout" ? 1 : 0);
    const disabled = record.status === "disabled";
    const cooldown = !disabled && (kind === "domain_rejected" || (kind === "verification_timeout" && verificationTimeoutCount >= 2));
    this.health.set(normalizedDomain, cloneHealth({
      ...record,
      status: disabled ? "disabled" : cooldown ? "cooldown" : record.status,
      failureCount: record.failureCount + 1,
      verificationTimeoutCount,
      mailboxRateLimitCount: record.mailboxRateLimitCount + (kind === "rate_limited" ? 1 : 0),
      quotaExhaustedCount: record.quotaExhaustedCount + (kind === "quota_exhausted" ? 1 : 0),
      lastFailureAt: now,
      cooldownUntil: disabled ? record.cooldownUntil : cooldown ? now + HEALTH_COOLDOWN_MS : record.cooldownUntil,
      weight: Math.max(1, record.weight - 10),
      lastCheckedAt: now,
      lastError: error
    }));
  }

  async replaceAutoSnapshot(records: YydsDomainHealthRecord[]): Promise<void> {
    const normalizedRecords = records.map(cloneHealth);
    const nextHealth = new Map<string, YydsDomainHealthRecord>(
      Array.from(this.health.entries()).map(([domain, record]) => [domain, cloneHealth(record)])
    );
    const nextAutoDomains = new Set(normalizedRecords.map((record) => record.domain));

    for (const [domain, record] of nextHealth.entries()) {
      if (record.lastAutoCheckedAt > 0 && !nextAutoDomains.has(domain)) {
        nextHealth.set(domain, {
          ...record,
          lastAutoCheckedAt: 0
        });
      }
    }
    for (const record of normalizedRecords) {
      const existing = nextHealth.get(record.domain);
      nextHealth.set(record.domain, existing
        ? mergeAutoSnapshotHealth(existing, record)
        : cloneHealth(record));
    }

    this.health.clear();
    for (const [domain, record] of nextHealth.entries()) {
      this.health.set(domain, record);
    }
  }
}

export class MysqlYydsDomainPoolStore implements YydsDomainPoolStore {
  private readonly pool: Pool;

  constructor(config: MysqlConfig) {
    this.pool = createMysqlPool(config);
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
        last_auto_checked_at BIGINT NOT NULL DEFAULT 0,
        last_error TEXT NULL
      )
    `);
    await this.addColumnIfMissing(
      "last_auto_checked_at",
      "ALTER TABLE yyds_domain_health ADD COLUMN last_auto_checked_at BIGINT NOT NULL DEFAULT 0"
    );
    await this.addIndexIfMissing(
      "yyds_domain_health",
      "idx_yyds_domain_health_pick",
      "CREATE INDEX idx_yyds_domain_health_pick ON yyds_domain_health(status, cooldown_until, weight, last_success_at, last_failure_at)"
    );
  }

  private async addColumnIfMissing(column: string, ddl: string): Promise<void> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'yyds_domain_health' AND COLUMN_NAME = :column
       LIMIT 1`,
      { column }
    );
    if (rows.length === 0) {
      try {
        await this.pool.query(ddl);
      } catch (error) {
        if (isDuplicateColumnError(error)) {
          return;
        }
        throw error;
      }
    }
  }

  private async addIndexIfMissing(tableName: string, indexName: string, ddl: string): Promise<void> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :tableName AND INDEX_NAME = :indexName
       LIMIT 1`,
      { tableName, indexName }
    );
    if (rows.length === 0) {
      await this.pool.query(ddl);
    }
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
    await this.saveHealthWithExecutor(this.pool, record);
  }

  async recordSuccess(domain: string, now: number): Promise<void> {
    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedDomain) {
      throw new Error("YYDS domain health domain must not be empty");
    }
    await this.pool.execute(
      `INSERT INTO yyds_domain_health
        (domain, status, success_count, failure_count, verification_timeout_count, mailbox_rate_limit_count,
         quota_exhausted_count, last_success_at, last_failure_at, cooldown_until, weight, last_checked_at,
         last_auto_checked_at, last_error)
       VALUES
        (:domain, 'active', 1, 0, 0, 0, 0, :now, 0, 0, :defaultWeight, :now, 0, NULL)
       ON DUPLICATE KEY UPDATE
        cooldown_until = IF(status = 'disabled', cooldown_until, 0),
        status = IF(status = 'disabled', 'disabled', 'active'),
        success_count = success_count + 1,
        last_success_at = :now,
        weight = GREATEST(:defaultWeight, weight + 1),
        last_checked_at = :now,
        last_error = NULL`,
      {
        domain: normalizedDomain,
        now,
        defaultWeight: DOMAIN_POOL_HEALTH_WEIGHT
      }
    );
  }

  async recordFailure(domain: string, kind: YydsFailureKind, error: string, now: number): Promise<void> {
    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedDomain) {
      throw new Error("YYDS domain health domain must not be empty");
    }
    const startsCooldown = kind === "domain_rejected";
    await this.pool.execute(
      `INSERT INTO yyds_domain_health
        (domain, status, success_count, failure_count, verification_timeout_count, mailbox_rate_limit_count,
         quota_exhausted_count, last_success_at, last_failure_at, cooldown_until, weight, last_checked_at,
         last_auto_checked_at, last_error)
       VALUES
        (:domain, :insertStatus, 0, 1, IF(:kind = 'verification_timeout', 1, 0),
         IF(:kind = 'rate_limited', 1, 0), IF(:kind = 'quota_exhausted', 1, 0),
         0, :now, :insertCooldownUntil, GREATEST(1, :defaultWeight - 10), :now, 0, :error)
       ON DUPLICATE KEY UPDATE
        cooldown_until = IF(status = 'disabled', cooldown_until,
          IF(:kind = 'domain_rejected' OR (:kind = 'verification_timeout' AND verification_timeout_count + 1 >= 2),
            :cooldownUntil,
            cooldown_until)),
        status = IF(status = 'disabled', 'disabled', IF(:kind = 'domain_rejected' OR (:kind = 'verification_timeout' AND verification_timeout_count + 1 >= 2), 'cooldown', status)),
        failure_count = failure_count + 1,
        verification_timeout_count = verification_timeout_count + IF(:kind = 'verification_timeout', 1, 0),
        mailbox_rate_limit_count = mailbox_rate_limit_count + IF(:kind = 'rate_limited', 1, 0),
        quota_exhausted_count = quota_exhausted_count + IF(:kind = 'quota_exhausted', 1, 0),
        last_failure_at = :now,
        weight = GREATEST(1, weight - 10),
        last_checked_at = :now,
        last_error = :error`,
      {
        domain: normalizedDomain,
        kind,
        error,
        now,
        defaultWeight: DOMAIN_POOL_HEALTH_WEIGHT,
        insertStatus: startsCooldown ? "cooldown" : "active",
        insertCooldownUntil: startsCooldown ? now + HEALTH_COOLDOWN_MS : 0,
        cooldownUntil: now + HEALTH_COOLDOWN_MS
      }
    );
  }

  async replaceAutoSnapshot(records: YydsDomainHealthRecord[]): Promise<void> {
    const normalizedRecords = records.map(cloneHealth);
    const domains = normalizedRecords.map((record) => record.domain);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      if (domains.length > 0) {
        await connection.execute(
          `UPDATE yyds_domain_health
           SET last_auto_checked_at = 0
           WHERE last_auto_checked_at > 0 AND domain NOT IN (${domains.map(() => "?").join(", ")})`,
          domains
        );
      } else {
        await connection.execute(
          "UPDATE yyds_domain_health SET last_auto_checked_at = 0 WHERE last_auto_checked_at > 0"
        );
      }
      for (const record of normalizedRecords) {
        await this.saveAutoSnapshotHealthWithExecutor(connection, record);
      }
      await connection.commit();
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original transaction failure for callers.
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  private async saveHealthWithExecutor(executor: Pick<Pool | PoolConnection, "execute">, record: YydsDomainHealthRecord): Promise<void> {
    const normalized = cloneHealth(record);
    await executor.execute(
      `INSERT INTO yyds_domain_health
        (domain, status, success_count, failure_count, verification_timeout_count, mailbox_rate_limit_count,
         quota_exhausted_count, last_success_at, last_failure_at, cooldown_until, weight, last_checked_at,
         last_auto_checked_at, last_error)
       VALUES
        (:domain, :status, :successCount, :failureCount, :verificationTimeoutCount, :mailboxRateLimitCount,
         :quotaExhaustedCount, :lastSuccessAt, :lastFailureAt, :cooldownUntil, :weight, :lastCheckedAt,
         :lastAutoCheckedAt, :lastError)
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
        last_auto_checked_at = VALUES(last_auto_checked_at),
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
        lastAutoCheckedAt: normalized.lastAutoCheckedAt,
        lastError: normalized.lastError ?? null
      }
    );
  }

  private async saveAutoSnapshotHealthWithExecutor(executor: Pick<PoolConnection, "execute">, record: YydsDomainHealthRecord): Promise<void> {
    const normalized = cloneHealth(record);
    await executor.execute(
      `INSERT INTO yyds_domain_health
        (domain, status, success_count, failure_count, verification_timeout_count, mailbox_rate_limit_count,
         quota_exhausted_count, last_success_at, last_failure_at, cooldown_until, weight, last_checked_at,
         last_auto_checked_at, last_error)
       VALUES
        (:domain, :status, :successCount, :failureCount, :verificationTimeoutCount, :mailboxRateLimitCount,
         :quotaExhaustedCount, :lastSuccessAt, :lastFailureAt, :cooldownUntil, :weight, :lastCheckedAt,
         :lastAutoCheckedAt, :lastError)
       ON DUPLICATE KEY UPDATE
        weight = GREATEST(weight, VALUES(weight)),
        last_checked_at = GREATEST(last_checked_at, VALUES(last_checked_at)),
        last_auto_checked_at = VALUES(last_auto_checked_at)`,
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
        lastAutoCheckedAt: normalized.lastAutoCheckedAt,
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
    lastCheckedAt: parseNonNegativeInteger(record.lastCheckedAt, 0),
    lastAutoCheckedAt: parseNonNegativeInteger(record.lastAutoCheckedAt, 0)
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
    lastAutoCheckedAt: Number(row.last_auto_checked_at),
    lastError: row.last_error ?? undefined
  });
}

function defaultHealthRecord(domain: string, now: number): YydsDomainHealthRecord {
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
    weight: DOMAIN_POOL_HEALTH_WEIGHT,
    lastCheckedAt: now,
    lastAutoCheckedAt: 0
  };
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

function mergeAutoSnapshotHealth(
  existing: YydsDomainHealthRecord,
  snapshot: YydsDomainHealthRecord
): YydsDomainHealthRecord {
  return cloneHealth({
    ...existing,
    domain: snapshot.domain,
    weight: Math.max(existing.weight, snapshot.weight),
    lastCheckedAt: Math.max(existing.lastCheckedAt, snapshot.lastCheckedAt),
    lastAutoCheckedAt: snapshot.lastAutoCheckedAt
  });
}

function isDuplicateColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { code?: unknown; errno?: unknown };
  return record.code === "ER_DUP_FIELDNAME" || record.errno === 1060;
}
