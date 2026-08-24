import { expect, test } from "bun:test";
import { openBun } from "./bun-driver";
import { loadRecentDialogueTurns } from "./turns";

test("latest dialogue query returns three final eventless pairs in chronological order", () => {
  const db = openBun(":memory:");
  try {
    db.exec(`
      CREATE TABLE turns (
        turn_id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL,
        input_text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE narrations (
        turn_id TEXT NOT NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL
      );
    `);
    for (const [index, player, gm] of [
      [1, "第一轮", "第一答"],
      [2, "第二轮", "第二答"],
      [3, "第三轮", "第三答"],
      [4, "第四轮", "第四答"],
    ] as const) {
      db.run("INSERT INTO turns VALUES (?, 'branch', ?, ?)", [`turn-${index}`, player, String(index)]);
      db.run("INSERT INTO narrations VALUES (?, ?, 'final')", [`turn-${index}`, gm]);
    }
    db.run("INSERT INTO turns VALUES ('draft', 'branch', '未定稿', '5')");
    db.run("INSERT INTO narrations VALUES ('draft', '不该出现', 'superseded')");

    expect(loadRecentDialogueTurns(db, "branch")).toEqual([
      { player: "第二轮", gm: "第二答" },
      { player: "第三轮", gm: "第三答" },
      { player: "第四轮", gm: "第四答" },
    ]);
  } finally {
    db.close();
  }
});
