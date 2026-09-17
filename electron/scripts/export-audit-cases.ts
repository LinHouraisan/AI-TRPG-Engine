import { existsSync, writeFileSync } from "node:fs";
import { openBun } from "../src/main/persist/bun-driver";
import { exportCandidateBatch } from "../src/main/services/audit-service";

const usage = "用法：bun scripts/export-audit-cases.ts --campaign <campaign.sqlite> --out <cases.jsonl> --manifest <cases.manifest.json>";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const campaign = argument("campaign");
const out = argument("out");
const manifestPath = argument("manifest");

if (!campaign || !out || !manifestPath) {
  console.error(usage);
  process.exitCode = 1;
} else if (!existsSync(campaign)) {
  console.error(`战役数据库不存在：${campaign}`);
  process.exitCode = 1;
} else {
  const db = openBun(campaign);
  try {
    const migration = db.get<{ migration_id: string }>(
      "SELECT migration_id FROM schema_migrations WHERE migration_id = '0008_turn_audit'",
    );
    if (!migration) throw new Error("数据库尚未应用 0008_turn_audit 迁移");
    const exported = exportCandidateBatch(db, new Date().toISOString());
    if (!exported) throw new Error("没有符合条件的 curated + complete 候选");
    writeFileSync(out, exported.jsonl, "utf8");
    writeFileSync(manifestPath, `${JSON.stringify(exported.manifest, null, 2)}\n`, "utf8");
    console.log(`已导出 ${exported.manifest.count} 条：${out}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
