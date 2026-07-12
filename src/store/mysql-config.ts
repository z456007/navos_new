import mysql, { type Pool } from "mysql2/promise";

export interface MysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
  queueLimit: number;
}

export type MysqlPoolInput = MysqlConfig | Pool;

export function createMysqlPool(config: MysqlConfig): Pool {
  return mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: config.connectionLimit,
    queueLimit: config.queueLimit,
    namedPlaceholders: true
  });
}

export function isMysqlPool(input: MysqlPoolInput): input is Pool {
  const candidate = input as Partial<Pick<Pool, "query" | "execute" | "getConnection" | "end">>;
  return typeof candidate.query === "function"
    && typeof candidate.execute === "function"
    && typeof candidate.getConnection === "function"
    && typeof candidate.end === "function";
}

export function resolveMysqlPool(input: MysqlPoolInput): Pool {
  return isMysqlPool(input) ? input : createMysqlPool(input);
}
