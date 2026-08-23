import { z } from "zod";
import { fileUrlPathnameToFsPath, resolveElectronPacksRoot } from "./pack-root";
import {
  conditionSchema,
  factSchema,
  itemSchema,
  lockSchema,
  manifestSchema,
  npcSchema,
  roomSchema,
  storyNodeSchema,
  type ConditionDef,
  type FactDef,
  type ItemDef,
  type LockDef,
  type ManifestDef,
  type NpcDef,
  type Predicate,
  type RoomDef,
  type StoryNodeDef,
} from "./schema";

export type Pack = {
  manifest: ManifestDef;
  rooms: RoomDef[];
  items: ItemDef[];
  locks: LockDef[];
  facts: FactDef[];
  npcs: NpcDef[];
  story: StoryNodeDef[];
  conditions: ConditionDef[];
  /** 事件里引用的资料包版本，改了资料就该改它 */
  ref: string;
};

export type PackSource = {
  manifest: unknown;
  rooms: unknown;
  items: unknown;
  locks: unknown;
  facts: unknown;
  npcs: unknown;
  story: unknown;
  conditions: unknown;
};

export type PackCounts = {
  rooms: number;
  items: number;
  locks: number;
  facts: number;
  npcs: number;
  story: number;
  conditions: number;
};

export type PackListing = {
  id: string;
  title: string;
  version: string;
  counts: PackCounts;
  available: boolean;
  reasons: string[];
  issues: LintIssue[];
};

const REQUIRED_FILES = [
  "pack",
  "rooms",
  "items",
  "locks",
  "facts",
  "npcs",
  "story",
  "conditions",
] as const;

/**
 * 没记住选过哪一份时用这个。界面把选择写进 localStorage，
 * 整页重载后从那边读回来——不能在运行时改 pack / packIndex，
 * 否则 narrate、router、keeper 会各拿各的，出现一半旧一半新。
 */
export const defaultPackId = "boarding-house";

const ACTIVE_PACK_KEY = "ai-trpg-engine-demo/active-pack";

export function readRememberedPackId(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(ACTIVE_PACK_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/** 只记账、不改单例。调用方写完必须重载页面，引擎才会按新编号装配。 */
export function rememberActivePack(id: string): void {
  localStorage.setItem(ACTIVE_PACK_KEY, id);
}

/**
 * Bun 直接跑脚本时没有 Vite 那套 glob 变换。
 * 浏览器走三元的另一支，这函数根本不会被调用。
 */
function scanPacksWithBun(): Record<string, unknown> {
  const packsDir = new URL(/* @vite-ignore */ "../data/packs/", import.meta.url);
  const cwd = fileUrlPathnameToFsPath(packsDir.pathname, process.platform);
  const result: Record<string, unknown> = {};
  for (const relative of new Bun.Glob("*/*.json").scanSync({ cwd, onlyFiles: true })) {
    const absolute = cwd.endsWith("/") ? `${cwd}${relative}` : `${cwd}/${relative}`;
    result[absolute] = JSON.parse(readUtf8(absolute));
  }
  return result;
}

function isElectronProcess(): boolean {
  return typeof process !== "undefined" && Boolean(process.versions?.electron);
}

/** Electron 主进程：按目录读 JSON。打包后用 AI_TRPG_PACKS_DIR 指到资料包。 */
function scanPacksWithNode(): Record<string, unknown> {
  const fs = process.getBuiltinModule?.("fs") as {
    readdirSync: (dir: string) => string[];
    readFileSync: (file: string, enc: string) => string;
    statSync: (file: string) => { isDirectory(): boolean };
  };
  const path = process.getBuiltinModule?.("path") as {
    join: (...parts: string[]) => string;
  };
  const root = resolveElectronPacksRoot(
    process.env.AI_TRPG_PACKS_DIR,
    (process as typeof process & { resourcesPath?: string }).resourcesPath,
    path?.join,
  );
  if (!fs || !path || !root) {
    throw new Error("主进程找不到资料包目录（AI_TRPG_PACKS_DIR）。");
  }
  const result: Record<string, unknown> = {};
  for (const dir of fs.readdirSync(root)) {
    const folder = path.join(root, dir);
    if (!fs.statSync(folder).isDirectory()) continue;
    for (const file of fs.readdirSync(folder)) {
      if (!file.endsWith(".json")) continue;
      const absolute = path.join(folder, file);
      result[absolute] = JSON.parse(fs.readFileSync(absolute, "utf8"));
    }
  }
  return result;
}

function readUtf8(path: string): string {
  // 不用 `import ... from "node:fs"`：Vite 会试图把 node:fs 打进浏览器包。
  const getBuiltin = (globalThis as {
    process?: { getBuiltinModule?: (name: string) => unknown };
  }).process?.getBuiltinModule;
  if (!getBuiltin) {
    throw new Error("读不到模组文件。请用 bun run pack:lint，或从 Vite 开发服务器加载。");
  }
  const fs = getBuiltin("fs") as { readFileSync: (file: string, enc: string) => string };
  return fs.readFileSync(path, "utf8");
}

const globbedJson: Record<string, unknown> =
  typeof Bun !== "undefined"
    ? scanPacksWithBun()
    : isElectronProcess()
      ? scanPacksWithNode()
      : import.meta.glob("../data/packs/*/*.json", { eager: true });

type Discovered = { dir: string; source: PackSource };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrapModule(mod: unknown): unknown {
  if (isRecord(mod) && "default" in mod) return mod.default;
  return mod;
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function looseString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

function toSource(files: Record<string, unknown>): PackSource | null {
  for (const name of REQUIRED_FILES) {
    if (!(name in files)) return null;
  }
  return {
    manifest: files.pack,
    rooms: files.rooms,
    items: files.items,
    locks: files.locks,
    facts: files.facts,
    npcs: files.npcs,
    story: files.story,
    conditions: files.conditions,
  };
}

function discoverPacks(): Discovered[] {
  const byDir = new Map<string, Record<string, unknown>>();
  for (const [path, mod] of Object.entries(globbedJson)) {
    const match = path.replaceAll("\\", "/").match(/\/packs\/([^/]+)\/([^/]+)\.json$/);
    if (!match) continue;
    const dir = match[1];
    const file = match[2];
    const bucket = byDir.get(dir) ?? {};
    bucket[file] = unwrapModule(mod);
    byDir.set(dir, bucket);
  }

  const found: Discovered[] = [];
  for (const [dir, files] of byDir) {
    const source = toSource(files);
    if (source) found.push({ dir, source });
  }
  found.sort((a, b) => a.dir.localeCompare(b.dir));
  return found;
}

const discovered = discoverPacks();

function findDiscovered(id: string): Discovered | undefined {
  const byDir = discovered.find((entry) => entry.dir === id);
  if (byDir) return byDir;
  return discovered.find((entry) => looseString(entry.source.manifest, "id") === id);
}

function formatSchemaError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "根";
        return `${path}：${issue.message}`;
      })
      .join("；");
  }
  return error instanceof Error ? error.message : String(error);
}

function countsOf(source: PackSource): PackCounts {
  return {
    rooms: countArray(source.rooms),
    items: countArray(source.items),
    locks: countArray(source.locks),
    facts: countArray(source.facts),
    npcs: countArray(source.npcs),
    story: countArray(source.story),
    conditions: countArray(source.conditions),
  };
}

function inspectSource(dir: string, source: PackSource): PackListing {
  const fallbackId = looseString(source.manifest, "id") ?? dir;
  const fallbackTitle = looseString(source.manifest, "title") ?? dir;
  const fallbackVersion = looseString(source.manifest, "version") ?? "?";
  try {
    const loaded = loadPack(source);
    const issues = lintPack(loaded);
    const errors = issues.filter((issue) => issue.level === "错误");
    return {
      id: loaded.manifest.id,
      title: loaded.manifest.title,
      version: loaded.manifest.version,
      counts: countsOf(source),
      available: errors.length === 0,
      reasons: errors.map((issue) => `${issue.where}：${issue.message}`),
      issues,
    };
  } catch (error) {
    const message = formatSchemaError(error);
    const issues: LintIssue[] = [{ level: "错误", where: fallbackId, message }];
    return {
      id: fallbackId,
      title: fallbackTitle,
      version: fallbackVersion,
      counts: countsOf(source),
      available: false,
      reasons: [message],
      issues,
    };
  }
}

/** 解析并校验一份资料包。模式不过就抛错，绝不让引擎带着半份资料开团。 */
export function loadPack(source: PackSource = packSource): Pack {
  const manifest = manifestSchema.parse(source.manifest);
  const pack: Pack = {
    manifest,
    rooms: roomSchema.array().parse(source.rooms),
    items: itemSchema.array().parse(source.items),
    locks: lockSchema.array().parse(source.locks),
    facts: factSchema.array().parse(source.facts),
    npcs: npcSchema.array().parse(source.npcs),
    story: storyNodeSchema.array().parse(source.story),
    conditions: conditionSchema.array().parse(source.conditions),
    ref: `${manifest.id}@${manifest.version}`,
  };
  return pack;
}

/**
 * 扫到的每一份模组各说各的：坏掉的只把自己标成不可用，
 * 不在扫描阶段把整个程序掀翻。
 */
export function listPacks(): PackListing[] {
  return discovered.map((entry) => inspectSource(entry.dir, entry.source));
}

/** 按编号加载并校验。这份本身坏了就抛，其它模组不受牵连。 */
export function loadPackById(id: string): Pack {
  const found = findDiscovered(id);
  if (!found) {
    const known = discovered.map((entry) => entry.dir).join("、") || "（一份都没有）";
    throw new Error(
      `仓库里没有编号为「${id}」的模组。目前扫到的是：${known}。` +
        "检查目录名和 pack.json 里的 id 是不是写错了。",
    );
  }
  let loaded: Pack;
  try {
    loaded = loadPack(found.source);
  } catch (error) {
    throw new Error(
      `模组「${id}」字段对不上规范，不能开团：${formatSchemaError(error)}。` +
        "对照 src/data/packs/SPEC.md 改这份 JSON，再跑 bun run pack:lint。",
    );
  }
  const errors = lintPack(loaded).filter((issue) => issue.level === "错误");
  if (errors.length > 0) {
    const detail = errors.map((issue) => `${issue.where}：${issue.message}`).join("；");
    throw new Error(
      `模组「${id}」引用对不上，不能开团：${detail}。先跑 bun run pack:lint 看完整报告。`,
    );
  }
  return loaded;
}

function resolveActivePackId(): string {
  const remembered = readRememberedPackId();
  if (!remembered) {
    return typeof window !== "undefined" || isElectronProcess() ? "mist-harbor" : defaultPackId;
  }
  try {
    loadPackById(remembered);
    return remembered;
  } catch {
    // 记着的那份坏了或没了：退回默认，选择器才能打开，把原因告诉作者。
    return defaultPackId;
  }
}

function activePackSource(): PackSource {
  const id = resolveActivePackId();
  const found = findDiscovered(id);
  if (!found) {
    throw new Error(
      `找不到当前生效的模组「${id}」。` +
        `确认 src/data/packs/${id}/ 下齐了八个 JSON，` +
        "缺一份引擎就没法开团。",
    );
  }
  return found.source;
}

/**
 * 一件东西什么时候看得见。这是资料包说了算的事，引擎只负责照着执行，
 * 所以判定口径必须只有这一处——散在各处的话，迟早有一处忘记加而漏出秘密。
 */
export type Visibility = { kind: "always" } | { kind: "never" } | { kind: "when"; when: Predicate };

export function itemVisibility(item: ItemDef): Visibility {
  if (item.revealedWhen) return { kind: "when", when: item.revealedWhen };
  if (item.lockedBy) return { kind: "when", when: { unlocked: item.lockedBy } };
  if (item.hidden) return { kind: "never" };
  return { kind: "always" };
}

export type LintIssue = { level: "错误" | "提醒"; where: string; message: string };

/**
 * 引用完整性检查。模式只能保证「字段长得对」，
 * 这里保证「指过去的东西真的存在」——两者缺一不可。
 */
export function lintPack(pack: Pack): LintIssue[] {
  const issues: LintIssue[] = [];
  const roomIds = new Set(pack.rooms.map((r) => r.id));
  const itemIds = new Set(pack.items.map((i) => i.id));
  const lockIds = new Set(pack.locks.map((l) => l.id));
  const factIds = new Set(pack.facts.map((f) => f.id));
  const npcIds = new Set(pack.npcs.map((n) => n.id));

  const refs = { roomIds, itemIds, lockIds, factIds, npcIds };
  const seen = new Set<string>();
  for (const id of [
    ...pack.rooms.map((r) => r.id),
    ...pack.items.map((i) => i.id),
    ...pack.locks.map((l) => l.id),
    ...pack.facts.map((f) => f.id),
    ...pack.npcs.map((n) => n.id),
    ...pack.story.map((n) => n.id),
    ...pack.conditions.map((c) => c.id),
  ]) {
    if (seen.has(id)) issues.push({ level: "错误", where: id, message: "编号重复" });
    seen.add(id);
  }

  for (const room of pack.rooms) {
    for (const exit of room.exits) {
      if (!roomIds.has(exit.to)) {
        issues.push({
          level: "错误",
          where: room.id,
          message: `出口「${exit.via}」通往不存在的房间 ${exit.to}`,
        });
        continue;
      }
      const back = pack.rooms.find((r) => r.id === exit.to);
      if (!back?.exits.some((e) => e.to === room.id)) {
        issues.push({
          level: "提醒",
          where: room.id,
          message: `出口「${exit.via}」通往 ${exit.to}，但那边没有回来的路（单向出口请确认是有意为之）`,
        });
      }
    }
  }

  for (const item of pack.items) {
    if (!roomIds.has(item.at)) {
      issues.push({ level: "错误", where: item.id, message: `初始位置 ${item.at} 不是房间` });
    }
    if (item.lockedBy && !lockIds.has(item.lockedBy)) {
      issues.push({ level: "错误", where: item.id, message: `引用了不存在的锁 ${item.lockedBy}` });
    }
    if (item.observeGrants && !factIds.has(item.observeGrants)) {
      issues.push({
        level: "错误",
        where: item.id,
        message: `观察时给出的线索 ${item.observeGrants} 没有定义`,
      });
    }
    if (item.read?.grants && !factIds.has(item.read.grants)) {
      issues.push({
        level: "错误",
        where: item.id,
        message: `阅读时给出的线索 ${item.read.grants} 没有定义`,
      });
    }
    if (item.lockedBy && !item.portable) {
      issues.push({
        level: "提醒",
        where: item.id,
        message: "挂了锁却又拿不走，玩家开锁之后会无事可做",
      });
    }
    if (item.revealedWhen) {
      checkPredicate(item.revealedWhen, `${item.id}.revealedWhen`, refs, issues);
      if (item.lockedBy && !mentionsLock(item.revealedWhen, item.lockedBy)) {
        issues.push({
          level: "提醒",
          where: item.id,
          message: `露面条件没有提到 ${item.lockedBy}，开锁之前它就会出现在场景里（确认是有意为之）`,
        });
      }
    }
    if (itemVisibility(item).kind === "never") {
      issues.push({
        level: "提醒",
        where: item.id,
        message: "藏起来了却没写露面条件，玩家永远看不到它",
      });
    }
  }

  for (const lock of pack.locks) {
    if (!roomIds.has(lock.at)) {
      issues.push({ level: "错误", where: lock.id, message: `所在位置 ${lock.at} 不是房间` });
    }
    const inside = pack.items.find((item) => item.id === lock.opens);
    if (!inside) {
      issues.push({ level: "错误", where: lock.id, message: `打开之后放出的 ${lock.opens} 不存在` });
    } else if (itemVisibility(inside).kind === "always") {
      issues.push({
        level: "提醒",
        where: lock.id,
        message: `${inside.id} 在开锁之前就看得见，等于提前把答案摆出来（隔着玻璃看得见但拿不走，才需要这么写）`,
      });
    }
    if (!(lock.skill in pack.manifest.investigator.skills)) {
      issues.push({
        level: "提醒",
        where: lock.id,
        message: `需要技能「${lock.skill}」，但预组调查员卡上没有这一项`,
      });
    }
  }

  for (const npc of pack.npcs) {
    if (!roomIds.has(npc.startAt)) {
      issues.push({ level: "错误", where: npc.id, message: `出生点 ${npc.startAt} 不是房间` });
    }
  }

  if (!roomIds.has(pack.manifest.investigator.startAt)) {
    issues.push({
      level: "错误",
      where: pack.manifest.investigator.id,
      message: `出生点 ${pack.manifest.investigator.startAt} 不是房间`,
    });
  }

  for (const node of pack.story) {
    checkPredicate(node.doneWhen, `${node.id}.doneWhen`, refs, issues);
    if (node.failedWhen) checkPredicate(node.failedWhen, `${node.id}.failedWhen`, refs, issues);
  }
  for (const condition of pack.conditions) {
    checkPredicate(condition.when, `${condition.id}.when`, refs, issues);
    for (const effect of condition.effects) {
      const event = effect.event;
      if (event.type === "npc_moved") {
        if (!npcIds.has(event.npc)) {
          issues.push({ level: "错误", where: condition.id, message: `NPC ${event.npc} 不存在` });
        }
        if (!roomIds.has(event.to)) {
          issues.push({ level: "错误", where: condition.id, message: `房间 ${event.to} 不存在` });
        }
      }
      if (event.type === "fact_known" && !factIds.has(event.fact)) {
        issues.push({ level: "错误", where: condition.id, message: `线索 ${event.fact} 不存在` });
      }
      if (event.type === "item_moved" && !itemIds.has(event.item)) {
        issues.push({ level: "错误", where: condition.id, message: `道具 ${event.item} 不存在` });
      }
    }
  }

  return issues;
}

/** 露面条件里到底提没提这把锁——只提一句「有没有」，不做真值判断。 */
function mentionsLock(predicate: Predicate, lock: string): boolean {
  if ("all" in predicate) return predicate.all.some((child) => mentionsLock(child, lock));
  if ("any" in predicate) return predicate.any.some((child) => mentionsLock(child, lock));
  if ("not" in predicate) return mentionsLock(predicate.not, lock);
  return "unlocked" in predicate && predicate.unlocked === lock;
}

type Refs = {
  roomIds: Set<string>;
  itemIds: Set<string>;
  lockIds: Set<string>;
  factIds: Set<string>;
  npcIds: Set<string>;
};

function checkPredicate(
  predicate: Predicate,
  where: string,
  refs: Refs,
  issues: LintIssue[],
): void {
  if ("all" in predicate) {
    for (const child of predicate.all) checkPredicate(child, where, refs, issues);
    return;
  }
  if ("any" in predicate) {
    for (const child of predicate.any) checkPredicate(child, where, refs, issues);
    return;
  }
  if ("not" in predicate) {
    checkPredicate(predicate.not, where, refs, issues);
    return;
  }
  if ("has" in predicate && !refs.itemIds.has(predicate.has)) {
    issues.push({ level: "错误", where, message: `道具 ${predicate.has} 不存在` });
  }
  if ("observed" in predicate && !refs.itemIds.has(predicate.observed)) {
    issues.push({ level: "错误", where, message: `道具 ${predicate.observed} 不存在` });
  }
  if ("unlocked" in predicate && !refs.lockIds.has(predicate.unlocked)) {
    issues.push({ level: "错误", where, message: `锁 ${predicate.unlocked} 不存在` });
  }
  if ("known" in predicate && !refs.factIds.has(predicate.known)) {
    issues.push({ level: "错误", where, message: `线索 ${predicate.known} 不存在` });
  }
  if ("pcAt" in predicate && !refs.roomIds.has(predicate.pcAt)) {
    issues.push({ level: "错误", where, message: `房间 ${predicate.pcAt} 不存在` });
  }
  if ("npcAt" in predicate) {
    if (!refs.npcIds.has(predicate.npcAt.npc)) {
      issues.push({ level: "错误", where, message: `NPC ${predicate.npcAt.npc} 不存在` });
    }
    if (!refs.roomIds.has(predicate.npcAt.room)) {
      issues.push({ level: "错误", where, message: `房间 ${predicate.npcAt.room} 不存在` });
    }
  }
}

/** 供引擎各处使用的索引视图。 */
export function indexPack(pack: Pack) {
  return {
    room: (id: string) => pack.rooms.find((r) => r.id === id),
    item: (id: string) => pack.items.find((i) => i.id === id),
    lock: (id: string) => pack.locks.find((l) => l.id === id),
    fact: (id: string) => pack.facts.find((f) => f.id === id),
    npc: (id: string) => pack.npcs.find((n) => n.id === id),
  };
}

/**
 * 当前生效的那一份。扫描阶段可以容忍坏包，这里不行——
 * 引擎其余文件直接读这两个导出，半份资料会让重放对不上。
 * 编号在模块求值时就定死，换模组只能重载页面。
 */
export const activePackId = resolveActivePackId();
export const packSource: PackSource = activePackSource();
export const pack = loadPackById(activePackId);
export const packIndex = indexPack(pack);
