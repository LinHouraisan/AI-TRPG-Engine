import Database from "better-sqlite3";
import { PRAGMAS, type Driver } from "./driver";

export function openBetterSqlite(path: string): Driver {
  const db = new Database(path);
  db.exec(PRAGMAS);
  return {
    name: "better-sqlite3",
    exec: (sql) => {
      db.exec(sql);
    },
    run: (sql, params = []) => {
      db.prepare(sql).run(...params);
    },
    get: <T>(sql: string, params: unknown[] = []) => db.prepare(sql).get(...params) as T | undefined,
    all: <T>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...params) as T[],
    transaction: <T>(work: () => T) => db.transaction(work)(),
    close: () => {
      db.close();
    },
  };
}
