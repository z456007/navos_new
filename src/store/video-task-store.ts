import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import type { MysqlConfig } from "./mysql-account-store.js";

export type VideoArchiveStatus = "pending" | "archiving" | "archived" | "failed" | "skipped";

export interface VideoTaskRecord {
  taskId: string;
  accountUid?: string;
  status: string;
  sourceUrl?: string;
  cosUrl?: string;
  cosKey?: string;
  archiveStatus: VideoArchiveStatus;
  archiveError?: string;
  sizeBytes?: number;
  sha256?: string;
  raw?: unknown;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  archivedAt?: number;
}

export interface SaveVideoTaskInput {
  taskId: string;
  accountUid?: string;
  status: string;
  sourceUrl?: string;
  cosUrl?: string;
  cosKey?: string;
  archiveStatus?: VideoArchiveStatus;
  archiveError?: string;
  sizeBytes?: number;
  sha256?: string;
  raw?: unknown;
  completedAt?: number;
  archivedAt?: number;
}

export interface VideoTaskStore {
  ensureSchema?(): Promise<void>;
  get(taskId: string): Promise<VideoTaskRecord | undefined>;
  upsert(input: SaveVideoTaskInput): Promise<VideoTaskRecord>;
}

interface VideoTaskRow extends RowDataPacket {
  task_id: string;
  account_uid: string | null;
  status: string;
  source_url: string | null;
  cos_url: string | null;
  cos_key: string | null;
  archive_status: VideoArchiveStatus;
  archive_error: string | null;
  size_bytes: number | null;
  sha256: string | null;
  raw_json: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  archived_at: number | null;
}

export class InMemoryVideoTaskStore implements VideoTaskStore {
  private readonly tasks = new Map<string, VideoTaskRecord>();

  async get(taskId: string): Promise<VideoTaskRecord | undefined> {
    const task = this.tasks.get(taskId);
    return task ? cloneRecord(task) : undefined;
  }

  async upsert(input: SaveVideoTaskInput): Promise<VideoTaskRecord> {
    const now = Date.now();
    const existing = this.tasks.get(input.taskId);
    const next: VideoTaskRecord = {
      taskId: input.taskId,
      accountUid: input.accountUid ?? existing?.accountUid,
      status: input.status,
      sourceUrl: input.sourceUrl ?? existing?.sourceUrl,
      cosUrl: input.cosUrl ?? existing?.cosUrl,
      cosKey: input.cosKey ?? existing?.cosKey,
      archiveStatus: input.archiveStatus ?? existing?.archiveStatus ?? "pending",
      archiveError: input.archiveError,
      sizeBytes: input.sizeBytes ?? existing?.sizeBytes,
      sha256: input.sha256 ?? existing?.sha256,
      raw: input.raw ?? existing?.raw,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      completedAt: input.completedAt ?? existing?.completedAt,
      archivedAt: input.archivedAt ?? existing?.archivedAt
    };
    this.tasks.set(input.taskId, next);
    return cloneRecord(next);
  }
}

export class MysqlVideoTaskStore implements VideoTaskStore {
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
      CREATE TABLE IF NOT EXISTS video_tasks (
        task_id VARCHAR(128) PRIMARY KEY,
        account_uid VARCHAR(128) NULL,
        status VARCHAR(32) NOT NULL,
        source_url VARCHAR(1000) NULL,
        cos_url VARCHAR(1000) NULL,
        cos_key VARCHAR(600) NULL,
        archive_status ENUM('pending', 'archiving', 'archived', 'failed', 'skipped') NOT NULL DEFAULT 'pending',
        archive_error TEXT NULL,
        size_bytes BIGINT NULL,
        sha256 VARCHAR(64) NULL,
        raw_json JSON NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        completed_at BIGINT NULL,
        archived_at BIGINT NULL,
        INDEX idx_video_tasks_status (status, archive_status, updated_at)
      )
    `);
    await this.addColumnIfMissing("account_uid", "ALTER TABLE video_tasks ADD COLUMN account_uid VARCHAR(128) NULL AFTER task_id");
  }

  private async addColumnIfMissing(column: string, ddl: string): Promise<void> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'video_tasks' AND COLUMN_NAME = :column
       LIMIT 1`,
      { column }
    );
    if (rows.length === 0) {
      await this.pool.query(ddl);
    }
  }

  async get(taskId: string): Promise<VideoTaskRecord | undefined> {
    const [rows] = await this.pool.execute<VideoTaskRow[]>("SELECT * FROM video_tasks WHERE task_id = :taskId LIMIT 1", { taskId });
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async upsert(input: SaveVideoTaskInput): Promise<VideoTaskRecord> {
    const existing = await this.get(input.taskId);
    const now = Date.now();
    const next: VideoTaskRecord = {
      taskId: input.taskId,
      accountUid: input.accountUid ?? existing?.accountUid,
      status: input.status,
      sourceUrl: input.sourceUrl ?? existing?.sourceUrl,
      cosUrl: input.cosUrl ?? existing?.cosUrl,
      cosKey: input.cosKey ?? existing?.cosKey,
      archiveStatus: input.archiveStatus ?? existing?.archiveStatus ?? "pending",
      archiveError: input.archiveError,
      sizeBytes: input.sizeBytes ?? existing?.sizeBytes,
      sha256: input.sha256 ?? existing?.sha256,
      raw: input.raw ?? existing?.raw,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      completedAt: input.completedAt ?? existing?.completedAt,
      archivedAt: input.archivedAt ?? existing?.archivedAt
    };
    await this.pool.execute(
      `INSERT INTO video_tasks
        (task_id, account_uid, status, source_url, cos_url, cos_key, archive_status, archive_error, size_bytes, sha256, raw_json, created_at, updated_at, completed_at, archived_at)
       VALUES
        (:taskId, :accountUid, :status, :sourceUrl, :cosUrl, :cosKey, :archiveStatus, :archiveError, :sizeBytes, :sha256, CAST(:rawJson AS JSON), :createdAt, :updatedAt, :completedAt, :archivedAt)
       ON DUPLICATE KEY UPDATE
        account_uid = COALESCE(VALUES(account_uid), account_uid),
        status = VALUES(status),
        source_url = VALUES(source_url),
        cos_url = VALUES(cos_url),
        cos_key = VALUES(cos_key),
        archive_status = VALUES(archive_status),
        archive_error = VALUES(archive_error),
        size_bytes = VALUES(size_bytes),
        sha256 = VALUES(sha256),
        raw_json = VALUES(raw_json),
        updated_at = VALUES(updated_at),
        completed_at = VALUES(completed_at),
        archived_at = VALUES(archived_at)`,
      {
        taskId: next.taskId,
        accountUid: next.accountUid ?? null,
        status: next.status,
        sourceUrl: next.sourceUrl ?? null,
        cosUrl: next.cosUrl ?? null,
        cosKey: next.cosKey ?? null,
        archiveStatus: next.archiveStatus,
        archiveError: next.archiveError ?? null,
        sizeBytes: next.sizeBytes ?? null,
        sha256: next.sha256 ?? null,
        rawJson: JSON.stringify(next.raw ?? null),
        createdAt: next.createdAt,
        updatedAt: next.updatedAt,
        completedAt: next.completedAt ?? null,
        archivedAt: next.archivedAt ?? null
      }
    );
    return next;
  }
}

function cloneRecord(record: VideoTaskRecord): VideoTaskRecord {
  return { ...record, raw: record.raw };
}

function fromRow(row: VideoTaskRow): VideoTaskRecord {
  return {
    taskId: row.task_id,
    accountUid: row.account_uid ?? undefined,
    status: row.status,
    sourceUrl: row.source_url ?? undefined,
    cosUrl: row.cos_url ?? undefined,
    cosKey: row.cos_key ?? undefined,
    archiveStatus: row.archive_status,
    archiveError: row.archive_error ?? undefined,
    sizeBytes: row.size_bytes ?? undefined,
    sha256: row.sha256 ?? undefined,
    raw: row.raw_json ? JSON.parse(row.raw_json) : undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    completedAt: row.completed_at === null ? undefined : Number(row.completed_at),
    archivedAt: row.archived_at === null ? undefined : Number(row.archived_at)
  };
}
