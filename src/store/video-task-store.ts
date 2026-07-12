import type { Pool, RowDataPacket } from "mysql2/promise";
import { resolveMysqlPool, type MysqlPoolInput } from "./mysql-config.js";

export interface VideoTaskRecord {
  taskId: string;
  accountUid?: string;
  status: string;
  sourceUrl?: string;
  raw?: unknown;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface SaveVideoTaskInput {
  taskId: string;
  accountUid?: string;
  status: string;
  sourceUrl?: string;
  raw?: unknown;
  completedAt?: number;
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
  raw_json: unknown;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
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
      raw: input.raw ?? existing?.raw,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      completedAt: input.completedAt ?? existing?.completedAt
    };
    this.tasks.set(input.taskId, next);
    return cloneRecord(next);
  }
}

export class MysqlVideoTaskStore implements VideoTaskStore {
  private readonly pool: Pool;

  constructor(input: MysqlPoolInput) {
    this.pool = resolveMysqlPool(input);
  }

  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS video_tasks (
        task_id VARCHAR(128) PRIMARY KEY,
        account_uid VARCHAR(128) NULL,
        status VARCHAR(32) NOT NULL,
        source_url VARCHAR(1000) NULL,
        raw_json JSON NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        completed_at BIGINT NULL,
        INDEX idx_video_tasks_status (status, updated_at)
      )
    `);
    await this.addColumnIfMissing("account_uid", "ALTER TABLE video_tasks ADD COLUMN account_uid VARCHAR(128) NULL AFTER task_id");
    await this.addIndexIfMissing(
      "video_tasks",
      "idx_video_tasks_account_updated",
      "CREATE INDEX idx_video_tasks_account_updated ON video_tasks(account_uid, updated_at)"
    );
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
      raw: input.raw ?? existing?.raw,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      completedAt: input.completedAt ?? existing?.completedAt
    };
    await this.pool.execute(
      `INSERT INTO video_tasks
        (task_id, account_uid, status, source_url, raw_json, created_at, updated_at, completed_at)
       VALUES
        (:taskId, :accountUid, :status, :sourceUrl, CAST(:rawJson AS JSON), :createdAt, :updatedAt, :completedAt)
       ON DUPLICATE KEY UPDATE
        account_uid = COALESCE(VALUES(account_uid), account_uid),
        status = VALUES(status),
        source_url = VALUES(source_url),
        raw_json = VALUES(raw_json),
        updated_at = VALUES(updated_at),
        completed_at = VALUES(completed_at)`,
      {
        taskId: next.taskId,
        accountUid: next.accountUid ?? null,
        status: next.status,
        sourceUrl: next.sourceUrl ?? null,
        rawJson: JSON.stringify(next.raw ?? null),
        createdAt: next.createdAt,
        updatedAt: next.updatedAt,
        completedAt: next.completedAt ?? null
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
    raw: parseVideoTaskRawJson(row.raw_json),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    completedAt: row.completed_at === null ? undefined : Number(row.completed_at)
  };
}

export function parseVideoTaskRawJson(value: unknown): unknown | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return JSON.parse(value) as unknown;
  }
  return value;
}
