import { Database } from "bun:sqlite";
import { PRAGMAS, type Driver } from "./driver";

export function openBun(path: string): Driver {
  const db = new Database(path);
  db.exec(PRAGMAS);
  return {
    name: "bun:sqlite",
    exec: (sql) => {
      db.exec(sql);
    },
    run: (sql, params = []) => {
      db.query(sql).run(...params);
    },
    get: <T>(sql: string, params: unknown[] = []) => db.query(sql).get(...params) as T | undefined,
    all: <T>(sql: string, params: unknown[] = []) => db.query(sql).all(...params) as T[],
    transaction: <T>(work: () => T) => db.transaction(work)(),
    close: () => {
      db.close();
    },
  };
}
