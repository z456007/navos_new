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
