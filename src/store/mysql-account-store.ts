import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import type { AccountImportInput, AccountRecord, AccountStatus, AccountStore } from "./account-store.js";

export interface MysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

interface AccountRow extends RowDataPacket {
  uid: string;
  token: string;
  mailbox_addr: string | null;
  mailbox_token: string | null;
  balance_remaining: number;
  balance_total: number;
  status: AccountStatus;
  created_at: number;
  last_used_at: number;
  last_balance_at: number;
  rate_limited_until: number;
  lease_id: string | null;
  lease_until: number;
}

export class MysqlAccountStore implements AccountStore {
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

  static async createDatabaseIfMissing(config: MysqlConfig): Promise<void> {
    const connection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password
    });
    try {
      await connection.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    } finally {
      await connection.end();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        uid VARCHAR(128) PRIMARY KEY,
        token TEXT NOT NULL,
        mailbox_addr VARCHAR(320) NULL,
        mailbox_token TEXT NULL,
        balance_remaining INT NOT NULL DEFAULT 0,
        balance_total INT NOT NULL DEFAULT 0,
        status ENUM('active', 'disabled', 'depleted') NOT NULL DEFAULT 'active',
        created_at BIGINT NOT NULL,
        last_used_at BIGINT NOT NULL DEFAULT 0,
        last_balance_at BIGINT NOT NULL DEFAULT 0,
        rate_limited_until BIGINT NOT NULL DEFAULT 0,
        lease_id VARCHAR(120) NULL,
        lease_until BIGINT NOT NULL DEFAULT 0,
        INDEX idx_accounts_pick (status, rate_limited_until, last_used_at, created_at)
      )
    `);
    await this.addColumnIfMissing("lease_id", "ALTER TABLE accounts ADD COLUMN lease_id VARCHAR(120) NULL");
    await this.addColumnIfMissing("lease_until", "ALTER TABLE accounts ADD COLUMN lease_until BIGINT NOT NULL DEFAULT 0");
  }

  private async addColumnIfMissing(column: string, ddl: string): Promise<void> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accounts' AND COLUMN_NAME = :column
       LIMIT 1`,
      { column }
    );
    if (rows.length === 0) {
      await this.pool.query(ddl);
    }
  }

  async upsert(account: AccountImportInput): Promise<AccountRecord> {
    const createdAt = Date.now();
    await this.pool.execute(
      `INSERT INTO accounts
        (uid, token, mailbox_addr, mailbox_token, balance_remaining, balance_total, status, created_at)
       VALUES
        (:uid, :token, :mailboxAddr, :mailboxToken, :balanceRemaining, :balanceTotal, :status, :createdAt)
       ON DUPLICATE KEY UPDATE
        token = VALUES(token),
        mailbox_addr = COALESCE(VALUES(mailbox_addr), mailbox_addr),
        mailbox_token = COALESCE(VALUES(mailbox_token), mailbox_token),
        balance_remaining = VALUES(balance_remaining),
        balance_total = VALUES(balance_total),
        status = VALUES(status)`,
      {
        uid: account.uid,
        token: account.token,
        mailboxAddr: account.mailboxAddr ?? null,
        mailboxToken: account.mailboxToken ?? null,
        balanceRemaining: account.balanceRemaining ?? 0,
        balanceTotal: account.balanceTotal ?? 0,
        status: account.status ?? "active",
        createdAt
      }
    );
    const saved = await this.get(account.uid);
    if (!saved) {
      throw new Error(`failed to load saved account ${account.uid}`);
    }
    return saved;
  }

  async list(): Promise<AccountRecord[]> {
    const [rows] = await this.pool.query<AccountRow[]>("SELECT * FROM accounts ORDER BY created_at ASC");
    return rows.map(fromRow);
  }

  async get(uid: string): Promise<AccountRecord | undefined> {
    const [rows] = await this.pool.execute<AccountRow[]>("SELECT * FROM accounts WHERE uid = :uid LIMIT 1", { uid });
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async pickActive(nowMs: number = Date.now()): Promise<AccountRecord | undefined> {
    const [rows] = await this.pool.execute<AccountRow[]>(
      `SELECT * FROM accounts
       WHERE status = 'active' AND rate_limited_until <= :nowMs AND lease_until <= :nowMs
       ORDER BY last_used_at ASC, created_at ASC
       LIMIT 1`,
      { nowMs }
    );
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async leaseActive(
    leaseId: string,
    leaseUntilMs: number,
    nowMs: number = Date.now(),
    minimumBalanceRemaining: number = 0
  ): Promise<AccountRecord | undefined> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<AccountRow[]>(
        `SELECT * FROM accounts
         WHERE status = 'active'
           AND rate_limited_until <= :nowMs
           AND lease_until <= :nowMs
           AND balance_remaining >= :minimumBalanceRemaining
         ORDER BY last_used_at ASC, created_at ASC
         LIMIT 1
         FOR UPDATE`,
        { nowMs, minimumBalanceRemaining }
      );
      const row = rows[0];
      if (!row) {
        await connection.rollback();
        return undefined;
      }
      await connection.execute(
        "UPDATE accounts SET lease_id = :leaseId, lease_until = :leaseUntilMs WHERE uid = :uid",
        { leaseId, leaseUntilMs, uid: row.uid }
      );
      await connection.commit();
      return {
        ...fromRow(row),
        leaseId,
        leaseUntil: leaseUntilMs
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async releaseLease(uid: string, leaseId?: string): Promise<void> {
    if (leaseId) {
      await this.pool.execute(
        "UPDATE accounts SET lease_id = NULL, lease_until = 0 WHERE uid = :uid AND lease_id = :leaseId",
        { uid, leaseId }
      );
      return;
    }
    await this.pool.execute("UPDATE accounts SET lease_id = NULL, lease_until = 0 WHERE uid = :uid", { uid });
  }

  async consumeLease(uid: string, leaseId: string | undefined, cost: number, nowMs: number = Date.now()): Promise<boolean> {
    const normalizedCost = Math.max(0, cost);
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE accounts
       SET status = CASE WHEN balance_remaining <= :cost THEN 'depleted' ELSE status END,
           balance_remaining = GREATEST(0, balance_remaining - :cost),
           last_balance_at = :nowMs,
           last_used_at = :nowMs,
           lease_id = NULL,
           lease_until = 0
       WHERE uid = :uid
         AND (:leaseId IS NULL OR lease_id = :leaseId)`,
      { uid, leaseId: leaseId ?? null, cost: normalizedCost, nowMs }
    );
    return result.affectedRows > 0;
  }

  async markUsed(uid: string, usedAtMs: number = Date.now()): Promise<void> {
    await this.pool.execute(
      "UPDATE accounts SET last_used_at = :usedAtMs, lease_id = NULL, lease_until = 0 WHERE uid = :uid",
      { uid, usedAtMs }
    );
  }

  async setStatus(uid: string, status: AccountStatus): Promise<void> {
    await this.pool.execute(
      "UPDATE accounts SET status = :status, lease_id = NULL, lease_until = 0 WHERE uid = :uid",
      { uid, status }
    );
  }

  async setBalance(uid: string, balanceRemaining: number, balanceTotal?: number, checkedAtMs: number = Date.now()): Promise<void> {
    await this.pool.execute(
      `UPDATE accounts
       SET balance_remaining = :balanceRemaining,
           balance_total = COALESCE(:balanceTotal, balance_total),
           last_balance_at = :checkedAtMs
       WHERE uid = :uid`,
      { uid, balanceRemaining, balanceTotal: balanceTotal ?? null, checkedAtMs }
    );
  }

  async setCooldown(uid: string, untilMs: number): Promise<void> {
    await this.pool.execute(
      "UPDATE accounts SET rate_limited_until = :untilMs, lease_id = NULL, lease_until = 0 WHERE uid = :uid",
      { uid, untilMs }
    );
  }
}

function fromRow(row: AccountRow): AccountRecord {
  return {
    uid: row.uid,
    token: row.token,
    mailboxAddr: row.mailbox_addr ?? undefined,
    mailboxToken: row.mailbox_token ?? undefined,
    balanceRemaining: row.balance_remaining,
    balanceTotal: row.balance_total,
    status: row.status,
    createdAt: Number(row.created_at),
    lastUsedAt: Number(row.last_used_at),
    lastBalanceAt: Number(row.last_balance_at),
    rateLimitedUntil: Number(row.rate_limited_until),
    leaseId: row.lease_id ?? undefined,
    leaseUntil: Number(row.lease_until ?? 0)
  };
}
