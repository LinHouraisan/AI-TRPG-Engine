import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import type { Driver, Row, SqlValue } from "./driver";

/**
 * 浏览器里的 SQLite。
 *
 * 走 kvvfs：数据库本身落在 localStorage 里，不需要跨源隔离头，刷新页面也还在。
 * 等 Demo 搬进 Tauri，这一层换成真正的 SQLite 文件，上面的仓储代码一行都不用改。
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
