import type { RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";
import type { MysqlConfig } from "./mysql-account-store.js";
import mysql from "mysql2/promise";

export interface CosConfigRaw {
  id: number;
  name: string;
  enabled: boolean;
  secretIdEnc: string;
  secretKeyEnc: string;
  bucket: string;
  region: string;
  appId?: string;
  publicDomain?: string;
  uploadPrefix: string;
  createdAt: number;
  updatedAt: number;
}

export interface SaveCosConfigRawInput {
  name: string;
  enabled: boolean;
  secretIdEnc: string;
  secretKeyEnc: string;
  bucket: string;
  region: string;
  appId?: string;
  publicDomain?: string;
  uploadPrefix: string;
}

export interface CosConfigStore {
  ensureSchema?(): Promise<void>;
  getRaw(): Promise<CosConfigRaw | undefined>;
  getEnabledRaw(): Promise<CosConfigRaw | undefined>;
  saveRaw(input: SaveCosConfigRawInput): Promise<CosConfigRaw>;
}

interface CosConfigRow extends RowDataPacket {
  id: number;
  name: string;
  enabled: 0 | 1;
  secret_id_enc: string;
  secret_key_enc: string;
  bucket: string;
  region: string;
  app_id: string | null;
  public_domain: string | null;
  upload_prefix: string;
  created_at: number;
  updated_at: number;
}

export class InMemoryCosConfigStore implements CosConfigStore {
  private config?: CosConfigRaw;

  async getRaw(): Promise<CosConfigRaw | undefined> {
    return this.config ? { ...this.config } : undefined;
  }

  async getEnabledRaw(): Promise<CosConfigRaw | undefined> {
    return this.config?.enabled ? { ...this.config } : undefined;
  }

  async saveRaw(input: SaveCosConfigRawInput): Promise<CosConfigRaw> {
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

export class MysqlCosConfigStore implements CosConfigStore {
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
      CREATE TABLE IF NOT EXISTS cos_config (
        id TINYINT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        secret_id_enc TEXT NOT NULL,
        secret_key_enc TEXT NOT NULL,
        bucket VARCHAR(160) NOT NULL,
        region VARCHAR(80) NOT NULL,
        app_id VARCHAR(40) NULL,
        public_domain VARCHAR(255) NULL,
        upload_prefix VARCHAR(180) NOT NULL DEFAULT 'navos/videos',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
  }

  async getRaw(): Promise<CosConfigRaw | undefined> {
    const [rows] = await this.pool.execute<CosConfigRow[]>("SELECT * FROM cos_config WHERE id = 1 LIMIT 1");
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async getEnabledRaw(): Promise<CosConfigRaw | undefined> {
    const [rows] = await this.pool.execute<CosConfigRow[]>("SELECT * FROM cos_config WHERE id = 1 AND enabled = 1 LIMIT 1");
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async saveRaw(input: SaveCosConfigRawInput): Promise<CosConfigRaw> {
    const now = Date.now();
    await this.pool.execute(
      `INSERT INTO cos_config
        (id, name, enabled, secret_id_enc, secret_key_enc, bucket, region, app_id, public_domain, upload_prefix, created_at, updated_at)
       VALUES
        (1, :name, :enabled, :secretIdEnc, :secretKeyEnc, :bucket, :region, :appId, :publicDomain, :uploadPrefix, :now, :now)
       ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        enabled = VALUES(enabled),
        secret_id_enc = VALUES(secret_id_enc),
        secret_key_enc = VALUES(secret_key_enc),
        bucket = VALUES(bucket),
        region = VALUES(region),
        app_id = VALUES(app_id),
        public_domain = VALUES(public_domain),
        upload_prefix = VALUES(upload_prefix),
        updated_at = VALUES(updated_at)`,
      {
        name: input.name,
        enabled: input.enabled ? 1 : 0,
        secretIdEnc: input.secretIdEnc,
        secretKeyEnc: input.secretKeyEnc,
        bucket: input.bucket,
        region: input.region,
        appId: input.appId ?? null,
        publicDomain: input.publicDomain ?? null,
        uploadPrefix: input.uploadPrefix,
        now
      }
    );
    const saved = await this.getRaw();
    if (!saved) {
      throw new Error("failed to load saved COS config");
    }
    return saved;
  }
}

function fromRow(row: CosConfigRow): CosConfigRaw {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    secretIdEnc: row.secret_id_enc,
    secretKeyEnc: row.secret_key_enc,
    bucket: row.bucket,
    region: row.region,
    appId: row.app_id ?? undefined,
    publicDomain: row.public_domain ?? undefined,
    uploadPrefix: row.upload_prefix,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}
