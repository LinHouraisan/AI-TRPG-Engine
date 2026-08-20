export type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;

/**
 * 存储驱动。上面那层只写 SQL，不关心底下是浏览器里的 SQLite 还是脚本里的 SQLite——
 * 这样同一套语句既能在浏览器里跑，也能在 bun 里被测到。
 */
export type Driver = {
  name: string;
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<void>;
  all<T extends Row>(sql: string, params?: SqlValue[]): Promise<T[]>;
  close(): Promise<void>;
};
