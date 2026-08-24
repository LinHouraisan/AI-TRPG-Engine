import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import type { Driver, Row, SqlValue } from "./driver";

/** 兜底用的内存库：SQL 与浏览器侧完全一致，区别只是关掉页面就没了。 */
export async function createMemoryDriver(): Promise<Driver> {
  const sqlite3 = await sqlite3InitModule();
  const db = new sqlite3.oo1.DB(":memory:");

  return {
    name: "sqlite-wasm/内存",
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
