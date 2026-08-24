/**
 * 把 Demo 的八份扁平 JSON 打成 V1 `.scenario-pack` ZIP。
 * 只搬家、不改字段；另生成 manifest.json 与 world/initial-state.json。
 *
 *   bun scripts/scenario-pack.ts pack <packId> [--output <file>]
 *   bun scripts/scenario-pack.ts inspect <file>
 *   bun scripts/scenario-pack.ts validate <file>
 *   bun scripts/scenario-pack.ts check
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix, sep } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const ZIP_STORE = 0;
const ZIP_DEFLATE = 8;
const UTF8_FLAG = 1 << 11;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFREG = 0o100644;
const HOST_UNIX = 3;
const MAX_ZIP_BYTES = 500 * 1024 * 1024;
const MAX_FILES = 10_000;
const MAX_JSON_BYTES = 10 * 1024 * 1024;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$/;

const SOURCE_FILES = [
  "pack.json",
  "rooms.json",
  "items.json",
  "npcs.json",
  "story.json",
  "facts.json",
  "locks.json",
  "conditions.json",
] as const;

/** 工作拷贝 → V1 包内路径。数据原样搬，只改位置。 */
const SOURCE_TO_V1 = {
  "pack.json": "scenario.json",
  "rooms.json": "entities/locations.json",
  "items.json": "entities/items.json",
  "npcs.json": "entities/characters.json",
  "story.json": "story/nodes.json",
  "facts.json": "story/clues.json",
  "locks.json": "world/locks.json",
  "conditions.json": "world/conditions.json",
} as const;

const REQUIRED_MAPPED = [
  "scenario.json",
  "entities/locations.json",
  "entities/items.json",
  "entities/characters.json",
  "story/nodes.json",
  "story/clues.json",
  "world/locks.json",
  "world/conditions.json",
  "world/initial-state.json",
] as const;

type ZipMember = {
  path: string;
  data: Uint8Array;
  unixMode: number;
  method: number;
};

type ZipWriteFile = {
  path: string;
  data: Uint8Array;
  unixMode?: number;
};

type ManifestEntry = {
  path: string;
  sha256: string;
  size: number;
  mime: string;
};

type ContentManifest = {
  formatVersion: 1;
  contentId: string;
  contentType: "scenario";
  version: string;
  name: { default: string; translations?: Record<string, string> };
  author: string;
  license: string;
  defaultLocale: string;
  locales: string[];
  engine: { minimumVersion: string; requiredCapabilities: string[] };
  dependencies: unknown[];
  entries: ManifestEntry[];
};

type Diagnostic = { code: string; file?: string; message: string };

type PackJson = {
  id: string;
  title: string;
  version: string;
  investigator: {
    startAt: string;
    hp: number;
    san: number;
    sanMax: number;
    skills: Record<string, number>;
  };
};

const packsDir = join(import.meta.dir, "../content/packs");
const defaultOutDir = join(import.meta.dir, "../dist-content");
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function u16le(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32le(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function crcOf(data: Uint8Array): number {
  return crc32(Buffer.from(data));
}

function mimeFor(path: string): string {
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".md")) return "text/markdown";
  return "application/octet-stream";
}

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} 必须是非空字符串`);
  }
  return value;
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} 必须是有限数字`);
  }
  return value;
}

function parsePackJson(value: unknown): PackJson {
  const root = asRecord(value, "pack.json");
  const investigator = asRecord(root.investigator, "pack.json investigator");
  const skillsRaw = asRecord(investigator.skills, "pack.json investigator.skills");
  const skills: Record<string, number> = {};
  for (const [key, skill] of Object.entries(skillsRaw)) {
    skills[key] = asNumber(skill, `skills.${key}`);
  }
  return {
    id: asString(root.id, "pack.json id"),
    title: asString(root.title, "pack.json title"),
    version: asString(root.version, "pack.json version"),
    investigator: {
      startAt: asString(investigator.startAt, "investigator.startAt"),
      hp: asNumber(investigator.hp, "investigator.hp"),
      san: asNumber(investigator.san, "investigator.san"),
      sanMax: asNumber(investigator.sanMax, "investigator.sanMax"),
      skills,
    },
  };
}

function idAtMap(value: unknown, atKey: "at" | "startAt", label: string): Record<string, string> {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  const map: Record<string, string> = {};
  for (const [index, row] of value.entries()) {
    const rec = asRecord(row, `${label}[${index}]`);
    map[asString(rec.id, `${label}[${index}].id`)] = asString(rec[atKey], `${label}[${index}].${atKey}`);
  }
  return map;
}

export function isUnsafeZipPath(raw: string): string | undefined {
  if (raw.length === 0) return "空路径";
  if (raw.includes("\0") || /[\x00-\x1f]/.test(raw)) return "含控制字符";
  if (raw.includes("\\")) return "反斜杠路径";
  if (raw.startsWith("/") || raw.startsWith("//")) return "绝对路径";
  if (/^[A-Za-z]:/.test(raw)) return "盘符路径";
  if (raw.includes(":")) return "NTFS 流或盘符";
  const segments = raw.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      return segment === ".." ? "含 .." : "空或当前目录段";
    }
    if (/[.\s]$/.test(segment)) return "尾随点或空格";
  }
  return undefined;
}

function writeZip(files: ZipWriteFile[]): Uint8Array {
  if (files.length > MAX_FILES) {
    throw new Error(`CONTENT_LIMIT_EXCEEDED: 文件数 ${files.length} > ${MAX_FILES}`);
  }
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.path);
    const data = file.data;
    const crc = crcOf(data);
    const unixMode = file.unixMode ?? S_IFREG;
    const local = concat([
      u32le(SIG_LOCAL),
      u16le(20),
      u16le(UTF8_FLAG),
      u16le(ZIP_STORE),
      u16le(0),
      u16le(0),
      u32le(crc),
      u32le(data.byteLength),
      u32le(data.byteLength),
      u16le(name.byteLength),
      u16le(0),
      name,
      data,
    ]);
    const central = concat([
      u32le(SIG_CENTRAL),
      u16le((HOST_UNIX << 8) | 20),
      u16le(20),
      u16le(UTF8_FLAG),
      u16le(ZIP_STORE),
      u16le(0),
      u16le(0),
      u32le(crc),
      u32le(data.byteLength),
      u32le(data.byteLength),
      u16le(name.byteLength),
      u16le(0),
      u16le(0),
      u16le(0),
      u16le(0),
      u32le((unixMode & 0xffff) << 16),
      u32le(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.byteLength;
  }
  const centralDir = concat(centrals);
  const eocd = concat([
    u32le(SIG_EOCD),
    u16le(0),
    u16le(0),
    u16le(files.length),
    u16le(files.length),
    u32le(centralDir.byteLength),
    u32le(offset),
    u16le(0),
  ]);
  const zip = concat([...locals, centralDir, eocd]);
  if (zip.byteLength > MAX_ZIP_BYTES) {
    throw new Error(`CONTENT_LIMIT_EXCEEDED: 压缩包 ${zip.byteLength} 字节`);
  }
  return zip;
}

function findEocd(bytes: Uint8Array): number {
  if (bytes.byteLength < 22) throw new Error("ZIP 太短");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const min = Math.max(0, bytes.byteLength - 22 - 65535);
  for (let i = bytes.byteLength - 22; i >= min; i -= 1) {
    if (view.getUint32(i, true) !== SIG_EOCD) continue;
    const commentLen = view.getUint16(i + 20, true);
    if (i + 22 + commentLen === bytes.byteLength) return i;
  }
  throw new Error("找不到 ZIP 中央目录");
}

function readZip(bytes: Uint8Array): ZipMember[] {
  if (bytes.byteLength > MAX_ZIP_BYTES) {
    throw new Error(`压缩包超过 ${MAX_ZIP_BYTES} 字节`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes);
  const diskEntries = view.getUint16(eocd + 8, true);
  const totalEntries = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (diskEntries !== totalEntries) throw new Error("不支持分卷 ZIP");
  if (totalEntries > MAX_FILES) throw new Error(`文件数 ${totalEntries} > ${MAX_FILES}`);
  if (cdOffset + cdSize > eocd) throw new Error("中央目录越界");

  const members: ZipMember[] = [];
  let cursor = cdOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (view.getUint32(cursor, true) !== SIG_CENTRAL) throw new Error("中央目录签名错误");
    const madeBy = view.getUint16(cursor + 4, true);
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressed = view.getUint32(cursor + 20, true);
    const uncompressed = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const external = view.getUint32(cursor + 38, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    cursor += 46 + nameLen + extraLen + commentLen;

    if (view.getUint32(localOffset, true) !== SIG_LOCAL) throw new Error(`${name} 本地头签名错误`);
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressed;
    if (dataEnd > bytes.byteLength) throw new Error(`${name} 数据越界`);
    let data = bytes.subarray(dataStart, dataEnd);
    if (method === ZIP_DEFLATE) data = new Uint8Array(inflateRawSync(data));
    else if (method !== ZIP_STORE) throw new Error(`${name} 不支持的压缩方法 ${method}`);
    if (data.byteLength !== uncompressed) throw new Error(`${name} 解压长度不符`);
    if (crcOf(data) !== crc) throw new Error(`${name} CRC 不符`);
    if (flags & 0x1) throw new Error(`${name} 加密条目`);

    const host = madeBy >> 8;
    const unixMode = host === HOST_UNIX || host === 19 ? (external >>> 16) & 0xffff : 0;
    members.push({ path: name, data, unixMode, method });
  }
  return members;
}

function initialStateFrom(pack: PackJson, npcAt: Record<string, string>, itemAt: Record<string, string>) {
  const investigator = pack.investigator;
  return {
    version: 0,
    turn: 0,
    clock: 0,
    pcAt: investigator.startAt,
    npcAt,
    itemAt,
    unlocked: {},
    observed: {},
    visited: { [investigator.startAt]: true },
    flags: {},
    known: [] as string[],
    hp: investigator.hp,
    hpMax: investigator.hp,
    san: investigator.san,
    sanMax: investigator.sanMax,
    skills: { ...investigator.skills },
  };
}

function readSourceBytes(filePath: string): Uint8Array {
  const st = lstatSync(filePath);
  if (st.isSymbolicLink()) throw new Error(`拒绝符号链接：${filePath}`);
  if (!st.isFile()) throw new Error(`不是普通文件：${filePath}`);
  return new Uint8Array(readFileSync(filePath));
}

function packIdSafe(packId: string): void {
  if (packId !== posix.basename(packId) || packId !== packId.replaceAll(sep, "")) {
    throw new Error(`非法 packId：${packId}`);
  }
  if (packId.includes("..") || isAbsolute(packId) || packId.includes(":") || packId.includes("/")) {
    throw new Error(`非法 packId：${packId}`);
  }
}

function buildPackedFiles(packId: string): { pack: PackJson; files: Map<string, Uint8Array> } {
  packIdSafe(packId);
  const dir = join(packsDir, packId);
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) {
    throw new Error(`找不到模组目录：${dir}`);
  }

  const files = new Map<string, Uint8Array>();
  const source: Record<string, Uint8Array> = {};
  for (const name of SOURCE_FILES) {
    const bytes = readSourceBytes(join(dir, name));
    source[name] = bytes;
    files.set(SOURCE_TO_V1[name], bytes);
  }

  const packBytes = source["pack.json"];
  const npcsBytes = source["npcs.json"];
  const itemsBytes = source["items.json"];
  if (!packBytes || !npcsBytes || !itemsBytes) throw new Error("八份源文件不齐");
  const pack = parsePackJson(JSON.parse(decoder.decode(packBytes)));
  if (pack.id !== packId) {
    throw new Error(`目录名 ${packId} 与 pack.json id ${pack.id} 不一致`);
  }
  if (!SEMVER.test(pack.version)) {
    throw new Error(`pack.json version 不是 SemVer：${pack.version}`);
  }

  const npcAt = idAtMap(JSON.parse(decoder.decode(npcsBytes)), "startAt", "npcs.json");
  const itemAt = idAtMap(JSON.parse(decoder.decode(itemsBytes)), "at", "items.json");
  files.set("world/initial-state.json", jsonBytes(initialStateFrom(pack, npcAt, itemAt)));
  return { pack, files };
}

function buildManifest(pack: PackJson, files: Map<string, Uint8Array>): ContentManifest {
  const entries: ManifestEntry[] = [...files.entries()]
    .map(([path, data]) => ({
      path,
      sha256: sha256Hex(data),
      size: data.byteLength,
      mime: mimeFor(path),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return {
    formatVersion: 1,
    contentId: pack.id,
    contentType: "scenario",
    version: pack.version,
    name: { default: pack.title },
    author: "",
    license: "",
    defaultLocale: "zh-Hans",
    locales: ["zh-Hans"],
    engine: { minimumVersion: "0.1.0", requiredCapabilities: [] },
    dependencies: [],
    entries,
  };
}

function packToZip(packId: string): { pack: PackJson; zip: Uint8Array; manifest: ContentManifest } {
  const { pack, files } = buildPackedFiles(packId);
  const manifest = buildManifest(pack, files);
  const zipFiles: ZipWriteFile[] = [
    { path: "manifest.json", data: jsonBytes(manifest) },
    ...[...files.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, data]) => ({ path, data })),
  ];
  return { pack, zip: writeZip(zipFiles), manifest };
}

function writeAtomic(filePath: string, data: Uint8Array): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, filePath);
}

function parseManifest(value: unknown): { manifest?: ContentManifest; errors: Diagnostic[] } {
  const errors: Diagnostic[] = [];
  let root: Record<string, unknown>;
  try {
    root = asRecord(value, "manifest.json");
  } catch (error) {
    return {
      errors: [{ code: "CONTENT_SCHEMA_INVALID", file: "manifest.json", message: String(error) }],
    };
  }
  if (root.formatVersion !== 1) {
    errors.push({
      code: "CONTENT_SCHEMA_INVALID",
      file: "manifest.json",
      message: `formatVersion 必须是 1，实际 ${String(root.formatVersion)}`,
    });
  }
  if (root.contentType !== "scenario") {
    errors.push({
      code: "CONTENT_SCHEMA_INVALID",
      file: "manifest.json",
      message: `contentType 必须是 scenario`,
    });
  }
  const contentId = root.contentId;
  const version = root.version;
  if (typeof contentId !== "string" || contentId.length < 1 || contentId.length > 120) {
    errors.push({
      code: "CONTENT_SCHEMA_INVALID",
      file: "manifest.json",
      message: "contentId 须为 1..120 字符",
    });
  }
  if (typeof version !== "string" || !SEMVER.test(version)) {
    errors.push({
      code: "CONTENT_SCHEMA_INVALID",
      file: "manifest.json",
      message: `version 必须是 SemVer，实际 ${String(version)}`,
    });
  }
  let nameDefault = "";
  try {
    const name = asRecord(root.name, "name");
    nameDefault = asString(name.default, "name.default");
  } catch (error) {
    errors.push({
      code: "CONTENT_SCHEMA_INVALID",
      file: "manifest.json",
      message: String(error),
    });
  }
  if (!Array.isArray(root.entries)) {
    errors.push({
      code: "CONTENT_SCHEMA_INVALID",
      file: "manifest.json",
      message: "entries 必须是数组",
    });
    return { errors };
  }
  const entries: ManifestEntry[] = [];
  for (const [index, row] of root.entries.entries()) {
    try {
      const rec = asRecord(row, `entries[${index}]`);
      entries.push({
        path: asString(rec.path, `entries[${index}].path`),
        sha256: asString(rec.sha256, `entries[${index}].sha256`),
        size: asNumber(rec.size, `entries[${index}].size`),
        mime: asString(rec.mime, `entries[${index}].mime`),
      });
    } catch (error) {
      errors.push({
        code: "CONTENT_SCHEMA_INVALID",
        file: "manifest.json",
        message: String(error),
      });
    }
  }
  if (errors.length > 0 || typeof contentId !== "string" || typeof version !== "string") {
    return { errors };
  }
  return {
    manifest: {
      formatVersion: 1,
      contentId,
      contentType: "scenario",
      version,
      name: { default: nameDefault },
      author: typeof root.author === "string" ? root.author : "",
      license: typeof root.license === "string" ? root.license : "",
      defaultLocale: typeof root.defaultLocale === "string" ? root.defaultLocale : "zh-Hans",
      locales: Array.isArray(root.locales) ? root.locales.filter((item) => typeof item === "string") : [],
      engine: { minimumVersion: "0.1.0", requiredCapabilities: [] },
      dependencies: Array.isArray(root.dependencies) ? root.dependencies : [],
      entries,
    },
    errors,
  };
}

export function validateZipBytes(bytes: Uint8Array): Diagnostic[] {
  const errors: Diagnostic[] = [];
  let members: ZipMember[];
  try {
    members = readZip(bytes);
  } catch (error) {
    return [
      {
        code: "CONTENT_CONTAINER_INVALID",
        message: error instanceof Error ? error.message : String(error),
      },
    ];
  }

  const byPath = new Map<string, ZipMember>();
  for (const member of members) {
    const reason = isUnsafeZipPath(member.path);
    if (reason) {
      errors.push({ code: "CONTENT_PATH_UNSAFE", file: member.path, message: reason });
      continue;
    }
    if ((member.unixMode & S_IFMT) === S_IFLNK) {
      errors.push({
        code: "CONTENT_CONTAINER_INVALID",
        file: member.path,
        message: "符号链接",
      });
      continue;
    }
    if (byPath.has(member.path)) {
      errors.push({
        code: "CONTENT_CONTAINER_INVALID",
        file: member.path,
        message: "重复路径",
      });
      continue;
    }
    byPath.set(member.path, member);
  }

  const manifestMember = byPath.get("manifest.json");
  if (!manifestMember) {
    errors.push({ code: "CONTENT_SCHEMA_INVALID", file: "manifest.json", message: "缺少 manifest.json" });
    return errors;
  }
  if (manifestMember.data.byteLength > MAX_JSON_BYTES) {
    errors.push({
      code: "CONTENT_LIMIT_EXCEEDED",
      file: "manifest.json",
      message: "JSON 超过 10 MiB",
    });
    return errors;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(manifestMember.data));
  } catch {
    errors.push({ code: "CONTENT_SCHEMA_INVALID", file: "manifest.json", message: "不是合法 JSON" });
    return errors;
  }
  const { manifest, errors: manifestErrors } = parseManifest(parsed);
  errors.push(...manifestErrors);
  if (!manifest) return errors;

  const declared = new Map<string, ManifestEntry>();
  for (const entry of manifest.entries) {
    if (entry.path === "manifest.json") {
      errors.push({
        code: "CONTENT_HASH_MISMATCH",
        file: "manifest.json",
        message: "entries 不得包含 manifest 自身",
      });
      continue;
    }
    const reason = isUnsafeZipPath(entry.path);
    if (reason) {
      errors.push({ code: "CONTENT_PATH_UNSAFE", file: entry.path, message: reason });
      continue;
    }
    if (declared.has(entry.path)) {
      errors.push({
        code: "CONTENT_HASH_MISMATCH",
        file: entry.path,
        message: "entries 重复声明",
      });
      continue;
    }
    declared.set(entry.path, entry);
  }

  for (const path of byPath.keys()) {
    if (path === "manifest.json") continue;
    if (!declared.has(path)) {
      errors.push({ code: "CONTENT_HASH_MISMATCH", file: path, message: "未在 manifest.entries 声明" });
    }
  }
  for (const [path, entry] of declared) {
    const member = byPath.get(path);
    if (!member) {
      errors.push({ code: "CONTENT_HASH_MISMATCH", file: path, message: "声明了但包内没有" });
      continue;
    }
    if (member.data.byteLength !== entry.size) {
      errors.push({
        code: "CONTENT_HASH_MISMATCH",
        file: path,
        message: `size ${member.data.byteLength} ≠ ${entry.size}`,
      });
    }
    const actual = sha256Hex(member.data);
    if (actual !== entry.sha256.toLowerCase()) {
      errors.push({
        code: "CONTENT_HASH_MISMATCH",
        file: path,
        message: `sha256 ${actual} ≠ ${entry.sha256}`,
      });
    }
    if (path.endsWith(".json") && member.data.byteLength > MAX_JSON_BYTES) {
      errors.push({ code: "CONTENT_LIMIT_EXCEEDED", file: path, message: "JSON 超过 10 MiB" });
    }
  }

  for (const required of REQUIRED_MAPPED) {
    if (!byPath.has(required) || !declared.has(required)) {
      errors.push({
        code: "CONTENT_SCHEMA_INVALID",
        file: required,
        message: "缺少必要映射文件",
      });
    }
  }
  return errors;
}

function printDiagnostics(errors: Diagnostic[]): void {
  for (const error of errors) {
    const where = error.file ? ` ${error.file}` : "";
    console.error(`✗ ${error.code}${where}  ${error.message}`);
  }
}

function commandPack(packId: string, outputArg?: string): string {
  const { pack, zip } = packToZip(packId);
  const output = outputArg ?? join(defaultOutDir, `${pack.id}-${pack.version}.scenario-pack`);
  writeAtomic(output, zip);
  return output;
}

function commandInspect(filePath: string): void {
  const bytes = new Uint8Array(readFileSync(filePath));
  const members = readZip(bytes);
  const manifestMember = members.find((member) => member.path === "manifest.json");
  if (!manifestMember) throw new Error("包内没有 manifest.json");
  const parsed = JSON.parse(decoder.decode(manifestMember.data)) as ContentManifest;
  console.log(`formatVersion  ${parsed.formatVersion}`);
  console.log(`contentId      ${parsed.contentId}`);
  console.log(`contentType    ${parsed.contentType}`);
  console.log(`version        ${parsed.version}`);
  console.log(`name           ${parsed.name?.default ?? ""}`);
  console.log(`entries        ${parsed.entries?.length ?? 0}`);
  console.log("");
  console.log("path                              size  mime                 sha256");
  for (const entry of parsed.entries ?? []) {
    console.log(
      `${entry.path.padEnd(32)} ${String(entry.size).padStart(6)}  ${entry.mime.padEnd(20)} ${entry.sha256}`,
    );
  }
  console.log("");
  console.log("zip members:");
  for (const member of members) {
    console.log(`  ${member.path}  (${member.data.byteLength} bytes)`);
  }
}

function commandValidate(filePath: string): boolean {
  const st = lstatSync(filePath);
  if (st.isSymbolicLink()) {
    printDiagnostics([{ code: "CONTENT_CONTAINER_INVALID", file: filePath, message: "符号链接" }]);
    return false;
  }
  const bytes = new Uint8Array(readFileSync(filePath));
  const errors = validateZipBytes(bytes);
  if (errors.length > 0) {
    printDiagnostics(errors);
    return false;
  }
  const members = readZip(bytes);
  const manifest = JSON.parse(
    decoder.decode(members.find((member) => member.path === "manifest.json")?.data ?? encoder.encode("{}")),
  ) as ContentManifest;
  console.log(
    `✓ ${manifest.contentId}@${manifest.version}  ${manifest.entries.length} files  formatVersion ${manifest.formatVersion}`,
  );
  return true;
}

function expectReject(bytes: Uint8Array, code: string, label: string, failed: { n: number }): void {
  const errors = validateZipBytes(bytes);
  const hit = errors.some((error) => error.code === code);
  if (hit) console.log(`✓ ${label}`);
  else {
    failed.n += 1;
    console.log(`✗ ${label}  期望 ${code}，实际 ${errors.map((error) => error.code).join(",") || "通过"}`);
  }
}

function commandCheck(): number {
  const failed = { n: 0 };
  const root = mkdtempSync(join(tmpdir(), "scenario-pack-"));
  try {
    const output = join(root, "boarding-house.scenario-pack");
    commandPack("boarding-house", output);
    console.log(`packed ${output}`);
    if (!commandValidate(output)) failed.n += 1;
    commandInspect(output);

    const good = packToZip("boarding-house");
    const files = new Map(readZip(good.zip).map((member) => [member.path, member]));
    const scenario = files.get("scenario.json");
    const initial = files.get("world/initial-state.json");
    if (!scenario || !initial) {
      console.log("✗ 好包缺少 scenario.json 或 initial-state.json");
      failed.n += 1;
    } else {
      const state = JSON.parse(decoder.decode(initial.data)) as { pcAt: string; npcAt: Record<string, string> };
      if (state.pcAt === "loc.hall" && state.npcAt["npc.landlady"] === "loc.landing") {
        console.log("✓ initial-state 来自 investigator.startAt 与 NPC/道具出生点");
      } else {
        failed.n += 1;
        console.log("✗ initial-state 字段不对");
      }
    }

    expectReject(
      writeZip([{ path: "../evil.json", data: encoder.encode("{}") }]),
      "CONTENT_PATH_UNSAFE",
      "拒绝 .. zipslip",
      failed,
    );
    expectReject(
      writeZip([{ path: "/tmp/evil.json", data: encoder.encode("{}") }]),
      "CONTENT_PATH_UNSAFE",
      "拒绝绝对路径",
      failed,
    );
    expectReject(
      writeZip([{ path: "C:/Windows/evil.json", data: encoder.encode("{}") }]),
      "CONTENT_PATH_UNSAFE",
      "拒绝盘符路径",
      failed,
    );
    expectReject(
      writeZip([
        { path: "link.json", data: encoder.encode("target"), unixMode: S_IFLNK | 0o777 },
        { path: "manifest.json", data: jsonBytes({ formatVersion: 1, contentType: "scenario", entries: [] }) },
      ]),
      "CONTENT_CONTAINER_INVALID",
      "拒绝符号链接条目",
      failed,
    );

    const extra = readZip(good.zip).map((member) => ({ path: member.path, data: member.data }));
    extra.push({ path: "undeclared.json", data: encoder.encode("{}\n") });
    expectReject(writeZip(extra), "CONTENT_HASH_MISMATCH", "拒绝未声明文件", failed);

    const tampered = readZip(good.zip).map((member) =>
      member.path === "scenario.json"
        ? { path: member.path, data: encoder.encode('{"id":"tampered"}\n') }
        : { path: member.path, data: member.data },
    );
    expectReject(writeZip(tampered), "CONTENT_HASH_MISMATCH", "拒绝哈希不符", failed);

    const missing = readZip(good.zip)
      .filter((member) => member.path !== "entities/locations.json")
      .map((member) => ({ path: member.path, data: member.data }));
    const missingManifest = JSON.parse(decoder.decode(missing.find((row) => row.path === "manifest.json")?.data ?? encoder.encode("{}"))) as ContentManifest;
    missingManifest.entries = missingManifest.entries.filter((entry) => entry.path !== "entities/locations.json");
    const missingZip = missing.map((row) =>
      row.path === "manifest.json" ? { path: row.path, data: jsonBytes(missingManifest) } : row,
    );
    expectReject(writeZip(missingZip), "CONTENT_SCHEMA_INVALID", "拒绝缺少必要映射文件", failed);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return failed.n;
}

function usage(): never {
  console.error(`用法：
  bun scripts/scenario-pack.ts pack <packId> [--output <file>]
  bun scripts/scenario-pack.ts inspect <file>
  bun scripts/scenario-pack.ts validate <file>
  bun scripts/scenario-pack.ts check`);
  process.exit(2);
}

function takeOutput(argv: string[]): { rest: string[]; output?: string } {
  const rest: string[] = [];
  let output: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--output") {
      const value = argv[i + 1];
      if (!value) usage();
      output = value;
      i += 1;
      continue;
    }
    rest.push(arg ?? "");
  }
  return { rest, output };
}

const argv = process.argv.slice(2);
const command = argv[0];
if (!command) usage();

try {
  if (command === "pack") {
    const { rest, output } = takeOutput(argv.slice(1));
    const packId = rest[0];
    if (!packId) usage();
    const written = commandPack(packId, output);
    console.log(written);
  } else if (command === "inspect") {
    const file = argv[1];
    if (!file) usage();
    commandInspect(file);
  } else if (command === "validate") {
    const file = argv[1];
    if (!file) usage();
    if (!commandValidate(file)) process.exit(1);
  } else if (command === "check") {
    const failed = commandCheck();
    if (failed) {
      console.log(`\n失败 ${failed} 项。`);
      process.exit(1);
    }
    console.log("\n全部通过。");
  } else {
    usage();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
