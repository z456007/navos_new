import type { RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";
import { createMysqlPool, type MysqlConfig } from "./mysql-config.js";

export interface YydsMailConfigRaw {
  id: number;
  enabled: boolean;
  apiKeyEnc: string;
  createdAt: number;
  updatedAt: number;
}

export interface SaveYydsMailConfigRawInput {
  enabled: boolean;
  apiKeyEnc: string;
}

export interface YydsMailConfigStore {
  ensureSchema?(): Promise<void>;
  getRaw(): Promise<YydsMailConfigRaw | undefined>;
  getEnabledRaw(): Promise<YydsMailConfigRaw | undefined>;
  saveRaw(input: SaveYydsMailConfigRawInput): Promise<YydsMailConfigRaw>;
}

interface YydsMailConfigRow extends RowDataPacket {
  id: number;
  enabled: 0 | 1;
  api_key_enc: string;
  created_at: number;
  updated_at: number;
}

export class InMemoryYydsMailConfigStore implements YydsMailConfigStore {
  private config?: YydsMailConfigRaw;

  async getRaw(): Promise<YydsMailConfigRaw | undefined> {
    return this.config ? { ...this.config } : undefined;
  }

  async getEnabledRaw(): Promise<YydsMailConfigRaw | undefined> {
    return this.config?.enabled ? { ...this.config } : undefined;
  }

  async saveRaw(input: SaveYydsMailConfigRawInput): Promise<YydsMailConfigRaw> {
    const now = Date.now();
    this.config = {
      id: 1,
      ...input,
      createdAt: this.config?.createdAt ?? now,
      updatedAt: now
    };
    return { ...this.config };
  }
}

export class MysqlYydsMailConfigStore implements YydsMailConfigStore {
  private readonly pool: Pool;

  constructor(config: MysqlConfig) {
    this.pool = createMysqlPool(config);
  }

  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS yyds_mail_config (
        id TINYINT PRIMARY KEY,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        api_key_enc TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
  }

  async getRaw(): Promise<YydsMailConfigRaw | undefined> {
    const [rows] = await this.pool.execute<YydsMailConfigRow[]>("SELECT * FROM yyds_mail_config WHERE id = 1 LIMIT 1");
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async getEnabledRaw(): Promise<YydsMailConfigRaw | undefined> {
    const [rows] = await this.pool.execute<YydsMailConfigRow[]>("SELECT * FROM yyds_mail_config WHERE id = 1 AND enabled = 1 LIMIT 1");
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async saveRaw(input: SaveYydsMailConfigRawInput): Promise<YydsMailConfigRaw> {
    const now = Date.now();
    await this.pool.execute(
      `INSERT INTO yyds_mail_config
        (id, enabled, api_key_enc, created_at, updated_at)
       VALUES
        (1, :enabled, :apiKeyEnc, :now, :now)
       ON DUPLICATE KEY UPDATE
        enabled = VALUES(enabled),
        api_key_enc = VALUES(api_key_enc),
        updated_at = VALUES(updated_at)`,
      {
        enabled: input.enabled ? 1 : 0,
        apiKeyEnc: input.apiKeyEnc,
        now
      }
    );
    const saved = await this.getRaw();
    if (!saved) {
      throw new Error("failed to load saved YYDS Mail config");
    }
    return saved;
  }
}

function fromRow(row: YydsMailConfigRow): YydsMailConfigRaw {
  return {
    id: row.id,
    enabled: row.enabled === 1,
    apiKeyEnc: row.api_key_enc,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}
