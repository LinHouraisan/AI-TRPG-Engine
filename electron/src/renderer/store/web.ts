import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import type { Driver, Row, SqlValue } from "./driver";

/**
 * 浏览器里的 SQLite。
 *
 * 走 kvvfs：数据库本身落在 localStorage 里，不需要跨源隔离头，刷新页面也还在。
 * Electron 主进程另有 better-sqlite3 + V1 DDL。浏览器这条路径只服务无壳试玩。
 */
export async function createWebDriver(name = "local"): Promise<Driver> {
  const sqlite3 = await sqlite3InitModule();
  const db = new sqlite3.oo1.JsStorageDb(name as "local" | "session");

  return {
    name: `sqlite-wasm/kvvfs(${name})`,
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params = []) {
      db.exec({ sql, bind: params });
    },
    async all<T extends Row>(sql: string, params: SqlValue[] = []) {
      return db.exec({
        sql,
        bind: params,
        rowMode: "object",
        returnValue: "resultRows",
      }) as unknown as T[];
    },
    async close() {
      db.close();
    },
  };
}
