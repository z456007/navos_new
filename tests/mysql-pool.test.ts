import { readFile } from "node:fs/promises";
import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { resolveMysqlPool } from "../src/store/mysql-config.js";

describe("MySQL pool wiring", () => {
  it("reuses an injected pool instead of creating a pool per store", () => {
    const sharedPool = {
      query: vi.fn(),
      execute: vi.fn(),
      getConnection: vi.fn(),
      end: vi.fn()
    } as unknown as Pool;

    expect(resolveMysqlPool(sharedPool)).toBe(sharedPool);
  });

  it("server bootstrap passes one shared MySQL pool to every MySQL-backed store", async () => {
    const source = await readFile("src/index.ts", "utf8");

    expect(source).toContain("const mysqlPool = createMysqlPool(config.mysql)");
    for (const storeName of [
      "MysqlAccountStore",
      "MysqlYydsMailConfigStore",
      "MysqlYydsDomainPoolStore",
      "MysqlImageTaskStore",
      "MysqlVideoTaskStore",
      "MysqlRuntimeConfigStore"
    ]) {
      expect(source).toContain(`new ${storeName}(mysqlPool)`);
      expect(source).not.toContain(`new ${storeName}(config.mysql)`);
    }
  });

  it("account leases skip locked rows instead of waiting behind hot rows", async () => {
    const source = await readFile("src/store/mysql-account-store.ts", "utf8");

    expect(source).toContain("FOR UPDATE SKIP LOCKED");
  });
});
