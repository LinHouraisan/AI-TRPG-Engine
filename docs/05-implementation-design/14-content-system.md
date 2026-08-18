# Content System

Status: Draft  
Implements: 文字卡、Scenario Pack、Rule Pack、导入与绑定  
Depends On: 公共约定、Persistence、Rule Engine、Scenario Runtime、Platform Security  
Consumed By: Runtime、Content Library UI、AI Content Tasks

## 1. 内容等级

`character_card` 只保证角色互动；`light_adventure` 提供场景、目标和少量结构化实体；`scenario_pack` 提供完整节点、线索、状态和规则绑定。等级由 validator 根据实际文件判定，manifest 声明不能提高实际等级。

## 2. 包结构

Scenario Pack：

```text
manifest.json
scenario.json
entities/characters.json
entities/items.json
entities/locations.json
scenes/*.json
story/nodes.json
story/clues.json
world/initial-state.json
prompts/style.md
assets/**
locales/<locale>.json
```

Rule Pack：

```text
manifest.json
attributes.json
resources.json
conditions.json
checks/*.json
effects.json
locales/<locale>.json
```

容器是 ZIP，扩展名 `.scenario-pack` / `.rule-pack`。禁止符号链接、硬链接、绝对路径、盘符、UNC、`..`、NTFS alternate stream 和尾随点/空格歧义。

## 3. Manifest

```ts
interface ContentManifest {
  formatVersion: 1;
  contentId: string;            // reverse-DNS 或 UUID，1..120
  contentType: "scenario" | "rule";
  version: string;              // SemVer
  name: LocalizedText;
  author: string;
  license: string;
  defaultLocale: string;
  locales: string[];
  engine: { minimumVersion: string; requiredCapabilities: string[] };
  dependencies: ContentDependency[];
  entries: { path: string; sha256: string; size: number; mime: string }[];
}
```

文件清单覆盖包内除 manifest 自身外的全部文件；存在未声明文件或哈希不符即拒绝。

## 4. 容量限制

- 压缩包最大 500 MiB；
- 文件数最大 10,000；
- 解压后最大 2 GiB；
- 解压倍率最大 100；
- 单 JSON 最大 10 MiB；
- 单图片最大 25 MiB、16,384×16,384；
- 单音频最大 100 MiB、60 分钟；
- Markdown 最大 2 MiB；
- JSON 嵌套最大 64 层。

超过限制返回明确诊断，不能部分导入。

## 5. 导入状态机

```text
selected → staged → container_validated → manifest_validated
 → migrated → schema_validated → semantic_validated
 → awaiting_confirmation → installed
任一步 → rejected
```

staging 使用新临时目录；验证完成后通过同卷原子 rename 安装。应用崩溃后清理超过 24 小时且无活动 lock 的 staging。

## 6. 诊断

```ts
interface ContentDiagnostic {
  severity: "error" | "warning" | "info" | "generated";
  code: string;
  file?: string;
  jsonPointer?: string;
  messageKey: string;
  details?: Record<string, string | number | boolean>;
}
```

error 阻止安装；warning 允许用户确认；generated 标识 AI 补充。最多展示 1000 条，超出给汇总。

## 7. Importer

CharacterCardImporter、WorldBookImporter、PlainTextImporter 输出统一 `ImportDraft`，逐字段记录 sourcePath、rawValueHash、mappedField、confidence 和 generated。原始文件哈希与副本保留。用户确认后才规范化安装。

文字卡 Prompt 属于不可信内容，放入模型数据区；不得创建 system/developer 指令、工具定义、文件路径或网络请求。

## 8. 内容库与绑定

全局内容库路径 `<contentType>/<contentId>/<version>/<hash>/`。同 ID/version 不同 hash 视为供应链冲突，不能覆盖。创建战役时把精确包复制或硬链接到战役内容快照；Windows 文件系统不支持安全链接时复制。

战役升级使用包提供的声明式 migration，先克隆战役备份，在临时数据库运行并重放验证，用户确认后替换。没有 migration 不升级进行中战役。

全局目录使用 Persistence 的 `installed_content`；战役只通过 `content_bindings` 固定精确版本。卸载前查询所有 campaign catalog 与 binding manifest；仍被引用时返回占用战役列表，禁止删除文件。

## 9. CLI

`content validate <path> --format json`、`content pack <directory> --output <path>`、`content inspect <path>`。CLI 与桌面复用同一 validator，不包含可视化编辑器。

## 10. 错误与测试

错误码包括 `CONTENT_CONTAINER_INVALID`、`CONTENT_PATH_UNSAFE`、`CONTENT_LIMIT_EXCEEDED`、`CONTENT_HASH_MISMATCH`、`CONTENT_SCHEMA_INVALID`、`CONTENT_REFERENCE_MISSING`、`CONTENT_DEPENDENCY_CONFLICT`、`CONTENT_ENGINE_INCOMPATIBLE`、`CONTENT_VERSION_COLLISION`、`CONTENT_MIGRATION_FAILED`。

测试使用恶意 ZIP、路径穿越、压缩炸弹、伪 MIME、循环依赖、不可达节点、非法 Rule AST、旧格式 migration 和文字卡 fixture。模糊测试解析器不得崩溃或写出 staging 目录。
