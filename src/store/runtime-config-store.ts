import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import type { RuntimeConfigView } from "../services/runtime-config-service.js";
import type { MysqlConfig } from "./mysql-account-store.js";

export interface RuntimeConfigStore {
  ensureSchema?(): Promise<void>;
  get(): Promise<RuntimeConfigView | undefined>;
  save(config: RuntimeConfigView): Promise<RuntimeConfigView>;
}

interface RuntimeConfigRow extends RowDataPacket {
  scope: string;
  value_json: unknown;
  updated_at: number;
}

const DEFAULT_SCOPE = "default";

export class InMemoryRuntimeConfigStore implements RuntimeConfigStore {
  private config: RuntimeConfigView | undefined;

  async get(): Promise<RuntimeConfigView | undefined> {
    return this.config ? { ...this.config } : undefined;
  }

  async save(config: RuntimeConfigView): Promise<RuntimeConfigView> {
    this.config = { ...config };
    return { ...this.config };
  }
}

export class MysqlRuntimeConfigStore implements RuntimeConfigStore {
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
      CREATE TABLE IF NOT EXISTS runtime_config (
        scope VARCHAR(64) PRIMARY KEY,
        value_json JSON NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
  }

  async get(): Promise<RuntimeConfigView | undefined> {
    const [rows] = await this.pool.execute<RuntimeConfigRow[]>(
      "SELECT * FROM runtime_config WHERE scope = :scope LIMIT 1",
      { scope: DEFAULT_SCOPE }
    );
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async save(config: RuntimeConfigView): Promise<RuntimeConfigView> {
    await this.pool.execute(
      `INSERT INTO runtime_config (scope, value_json, updated_at)
       VALUES (:scope, CAST(:valueJson AS JSON), :updatedAt)
       ON DUPLICATE KEY UPDATE
        value_json = VALUES(value_json),
        updated_at = VALUES(updated_at)`,
      {
        scope: DEFAULT_SCOPE,
        valueJson: JSON.stringify({ imageAllowVideoReserveFallback: config.imageAllowVideoReserveFallback }),
        updatedAt: config.updatedAt
      }
    );
    return config;
  }
}

function fromRow(row: RuntimeConfigRow): RuntimeConfigView {
  const parsed = parseValueJson(row.value_json);
  return {
    imageAllowVideoReserveFallback: parsed.imageAllowVideoReserveFallback === true,
    updatedAt: Number(row.updated_at)
  };
}

function parseValueJson(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    return JSON.parse(value) as Record<string, unknown>;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
