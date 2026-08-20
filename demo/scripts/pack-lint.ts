/**
 * 资料包体检：把扫到的每一份都过一遍模式和引用。
 * 「错误」一律不给过；「提醒」只打印，作者自己判断是不是有意为之。
 * 任何一份有错误，退出码就非零——坏包不能混进「全部可用」。
 *
 * 运行：cd demo && bun run pack:lint
 */
import {
  itemVisibility,
  lintPack,
  listPacks,
  loadPack,
  loadPackById,
  packSource,
} from "@/engine/pack";

const listings = listPacks();

if (listings.length === 0) {
  console.error("一份模组都没扫到。确认 src/data/packs/<编号>/ 下齐了八个 JSON。");
  process.exit(1);
}

let failed = false;

for (const listing of listings) {
  const errors = listing.issues.filter((issue) => issue.level === "错误");
  const warnings = listing.issues.filter((issue) => issue.level === "提醒");

  console.log(`\n— ${listing.id}@${listing.version} 《${listing.title}》—`);
  console.log(
    `房间 ${listing.counts.rooms}，道具 ${listing.counts.items}，锁 ${listing.counts.locks}，` +
      `线索 ${listing.counts.facts}，NPC ${listing.counts.npcs}，` +
      `剧情节点 ${listing.counts.story}，条件 ${listing.counts.conditions}。`,
  );

  for (const issue of warnings) console.log(`! 提醒 ${issue.where}：${issue.message}`);
  // 错误也走 stdout，避免和「共 N 份」抢行，报告才能按模组一段一段读。
  for (const issue of errors) console.log(`✗ 错误 ${issue.where}：${issue.message}`);

  if (!listing.available) {
    console.log(`这份模组不可用：${listing.reasons.join("；") || "体检未通过"}。`);
    failed = true;
  } else {
    console.log(`✓ 引用完整，${warnings.length} 条提醒。`);
  }
}

const available = listings.filter((listing) => listing.available).length;
console.log(`\n共 ${listings.length} 份模组，${available} 份可用。`);

if (failed) {
  console.log("有模组过不了体检。先改到不再报错，再开团。");
  process.exit(1);
}

/**
 * 体检自己也要被检查一遍：故意写坏几处可见性，看它抓不抓得住。
 * 这几条是防泄底的最后一道关口，坏了不会报错，只会安静地放行。
 */
console.log("\n— 规范自检：故意写坏，看体检认不认得出来 —");

const source = JSON.parse(JSON.stringify(packSource)) as typeof packSource;

expect(
  "锁保护的东西在开锁之前就看得见",
  (draft) => {
    delete draft.items[1].lockedBy;
  },
  "提前把答案摆出来",
);

expect(
  "藏起来却没写露面条件",
  (draft) => {
    delete draft.items[1].lockedBy;
    draft.items[1].hidden = true;
  },
  "玩家永远看不到它",
);

expect(
  "露面条件绕过了那把锁",
  (draft) => {
    draft.items[1].revealedWhen = { observed: "item.desk_lock" };
  },
  "露面条件没有提到 lock.desk",
);

expect(
  "露面条件引用了不存在的线索",
  (draft) => {
    draft.items[1].revealedWhen = { known: "fact.nope" };
  },
  "线索 fact.nope 不存在",
);

/**
 * 第二份（以及以后每一份）模组也必须自己证明可见性规范。
 * 只靠人眼看 JSON，下一次写反了不会有人喊。
 */
console.log("\n— 规范自检：藏着的东西不能被判定成一进门就看得见 —");

for (const listing of listPacks()) {
  const loaded = loadPackById(listing.id);
  for (const item of loaded.items) {
    if (!item.lockedBy && !item.hidden) continue;
    if (itemVisibility(item).kind === "always") {
      console.error(
        `✗ ${listing.id} 的 ${item.id} 写了 lockedBy 或 hidden，` +
          "判定却是一进门就看得见",
      );
      process.exit(1);
    }
  }
}
console.log("✓ 凡是写了 lockedBy 或 hidden 的道具，都不会被判定成 always");

const photo = loadPackById("photo-studio");
const wetPrint = photo.items.find((item) => item.id === "item.wet_print");
if (!wetPrint) {
  console.error("✗ photo-studio 里找不到 item.wet_print，第二份模组的可见性样本丢了");
  process.exit(1);
}
const wetVisibility = itemVisibility(wetPrint);
const hiddenUntilUnlock =
  wetVisibility.kind === "when" &&
  "unlocked" in wetVisibility.when &&
  wetVisibility.when.unlocked === wetPrint.lockedBy;
if (!hiddenUntilUnlock) {
  console.error("✗ item.wet_print 在锁没开时算看得见，可见性规范在第二份模组上没站住");
  process.exit(1);
}
console.log("✓ photo-studio 的未干相片在锁没开时算看不见");

// biome-ignore lint/suspicious/noExplicitAny: 这里就是要把资料改坏，绕开类型
function expect(label: string, breakIt: (draft: any) => void, expected: string): void {
  const draft = JSON.parse(JSON.stringify(source));
  breakIt(draft);
  const found = lintPack(loadPack(draft)).some((issue) => issue.message.includes(expected));
  if (!found) {
    console.error(`✗ ${label}：体检没认出来，防泄底的关口漏了`);
    process.exit(1);
  }
  console.log(`✓ ${label}`);
}
