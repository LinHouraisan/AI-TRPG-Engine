import { Database } from "bun:sqlite";
import type { Driver, Row, SqlValue } from "./driver";

/**
 * 脚本里的 SQLite。浏览器不会走到这里，它只是为了让同一套 SQL 能被测到——
 * 存储层最怕的就是「只有真在浏览器里点一遍才知道对不对」。
 */
export function createBunDriver(path = ":memory:"): Driver {
  const db = new Database(path);
  return {
    name: `bun:sqlite(${path})`,
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params = []) {
      db.query(sql).run(...(params as never[]));
    },
    async all<T extends Row>(sql: string, params: SqlValue[] = []) {
      return db.query(sql).all(...(params as never[])) as T[];
    },
    async close() {
      db.close();
    },
  };
}
