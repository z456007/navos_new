import type { Pool, RowDataPacket } from "mysql2/promise";
import { createMysqlPool, type MysqlConfig } from "./mysql-config.js";
import type { ImageTaskPollPath } from "../protocols/image.js";
import { parseVideoTaskRawJson } from "./video-task-store.js";

export interface ImageTaskRecord {
  taskId: string;
  accountUid?: string;
  leaseId?: string;
  pollPath: ImageTaskPollPath;
  status: string;
  sourceUrl?: string;
  raw?: unknown;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface SaveImageTaskInput {
  taskId: string;
  accountUid?: string;
  leaseId?: string;
  pollPath: ImageTaskPollPath;
  status: string;
  sourceUrl?: string;
  raw?: unknown;
  completedAt?: number;
}

export interface ImageTaskStore {
  ensureSchema?(): Promise<void>;
  get(taskId: string): Promise<ImageTaskRecord | undefined>;
  upsert(input: SaveImageTaskInput): Promise<ImageTaskRecord>;
}

interface ImageTaskRow extends RowDataPacket {
  task_id: string;
  account_uid: string | null;
  lease_id: string | null;
  poll_path: ImageTaskPollPath;
  status: string;
  source_url: string | null;
  raw_json: unknown;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export class InMemoryImageTaskStore implements ImageTaskStore {
  private readonly tasks = new Map<string, ImageTaskRecord>();

  async get(taskId: string): Promise<ImageTaskRecord | undefined> {
    const task = this.tasks.get(taskId);
    return task ? cloneRecord(task) : undefined;
  }

  async upsert(input: SaveImageTaskInput): Promise<ImageTaskRecord> {
    const now = Date.now();
    const existing = this.tasks.get(input.taskId);
    const next: ImageTaskRecord = {
      taskId: input.taskId,
      accountUid: input.accountUid ?? existing?.accountUid,
      leaseId: input.leaseId ?? existing?.leaseId,
      pollPath: input.pollPath,
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

export class MysqlImageTaskStore implements ImageTaskStore {
  private readonly pool: Pool;

  constructor(config: MysqlConfig) {
    this.pool = createMysqlPool(config);
  }

  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS image_tasks (
        task_id VARCHAR(128) PRIMARY KEY,
        account_uid VARCHAR(128) NULL,
        lease_id VARCHAR(120) NULL,
        poll_path VARCHAR(64) NOT NULL,
        status VARCHAR(32) NOT NULL,
        source_url VARCHAR(1000) NULL,
        raw_json JSON NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        completed_at BIGINT NULL,
        INDEX idx_image_tasks_status (status, updated_at)
      )
    `);
    await this.addIndexIfMissing(
      "image_tasks",
      "idx_image_tasks_account_updated",
      "CREATE INDEX idx_image_tasks_account_updated ON image_tasks(account_uid, updated_at)"
    );
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

  async get(taskId: string): Promise<ImageTaskRecord | undefined> {
    const [rows] = await this.pool.execute<ImageTaskRow[]>("SELECT * FROM image_tasks WHERE task_id = :taskId LIMIT 1", { taskId });
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async upsert(input: SaveImageTaskInput): Promise<ImageTaskRecord> {
    const existing = await this.get(input.taskId);
    const now = Date.now();
    const next: ImageTaskRecord = {
      taskId: input.taskId,
      accountUid: input.accountUid ?? existing?.accountUid,
      leaseId: input.leaseId ?? existing?.leaseId,
      pollPath: input.pollPath,
      status: input.status,
      sourceUrl: input.sourceUrl ?? existing?.sourceUrl,
      raw: input.raw ?? existing?.raw,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      completedAt: input.completedAt ?? existing?.completedAt
    };
    await this.pool.execute(
      `INSERT INTO image_tasks
        (task_id, account_uid, lease_id, poll_path, status, source_url, raw_json, created_at, updated_at, completed_at)
       VALUES
        (:taskId, :accountUid, :leaseId, :pollPath, :status, :sourceUrl, CAST(:rawJson AS JSON), :createdAt, :updatedAt, :completedAt)
       ON DUPLICATE KEY UPDATE
        account_uid = COALESCE(VALUES(account_uid), account_uid),
        lease_id = COALESCE(VALUES(lease_id), lease_id),
        poll_path = VALUES(poll_path),
        status = VALUES(status),
        source_url = VALUES(source_url),
        raw_json = VALUES(raw_json),
        updated_at = VALUES(updated_at),
        completed_at = VALUES(completed_at)`,
      {
        taskId: next.taskId,
        accountUid: next.accountUid ?? null,
        leaseId: next.leaseId ?? null,
        pollPath: next.pollPath,
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

function cloneRecord(record: ImageTaskRecord): ImageTaskRecord {
  return { ...record, raw: record.raw };
}

function fromRow(row: ImageTaskRow): ImageTaskRecord {
  return {
    taskId: row.task_id,
    accountUid: row.account_uid ?? undefined,
    leaseId: row.lease_id ?? undefined,
    pollPath: row.poll_path,
    status: row.status,
    sourceUrl: row.source_url ?? undefined,
    raw: parseVideoTaskRawJson(row.raw_json),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    completedAt: row.completed_at === null ? undefined : Number(row.completed_at)
  };
}
