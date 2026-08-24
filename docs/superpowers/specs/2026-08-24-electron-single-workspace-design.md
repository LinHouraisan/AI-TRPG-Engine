# Electron 单工作区归并设计

Status: Accepted by product owner in chat on 2026-08-24

## 1. 目标

把当前 `demo/` 中仍由桌面程序使用的渲染器、游戏内核、AI 守秘人、角色系统、存储适配、模组数据和测试迁入 `electron/`，形成一个能够独立安装依赖、开发、测试、构建和打包的 Electron 应用工作区。同时删除不再需要的浏览器独立 Demo 与 `handbook/` 作者手册，使仓库结构与实际产品边界一致。

## 2. 非目标

- 不改变玩法、叙述、角色创建、检定或模组内容。
- 不改变数据库结构、存档位置、IPC 接口或模组 ID。
- 不重写业务模块，也不趁迁移重构相邻代码。
- 不保留浏览器独立运行模式、Ollama 开发代理或 Astro 作者手册。
- 不将构建产物、依赖目录或旧浏览器说明迁入新源码树。

## 3. 最终目录

```text
electron/
├─ src/
│  ├─ main/
│  ├─ preload/
│  ├─ renderer/
│  ├─ core/
│  └─ shared/
├─ content/packs/
├─ scripts/
├─ sql/
├─ tests/
├─ package.json
├─ tsconfig.json
└─ vite.config.ts
```

职责如下：

- `src/main`：窗口生命周期、IPC、凭据、SQLite 持久化和桌面服务。
- `src/preload`：受控的 `desktopApi` 安全桥。
- `src/renderer`：React 入口、UI、会话协调、桌面适配和渲染端存储。
- `src/core`：事件引擎、规则、角色、AI 守秘人、卡片与通用游戏逻辑。
- `src/shared`：主进程、preload 与 renderer 共用的 IPC 和输入契约。
- `content/packs`：随应用分发的三个 Scenario Pack。
- `tests`：只存放真正跨模块的集成测试和 E2E；单元测试继续与被测模块相邻。

## 4. 迁移映射

- `electron/main` → `electron/src/main`
- `electron/preload` → `electron/src/preload`
- `electron/shared` → `electron/src/shared`
- `demo/src/ui` → `electron/src/renderer/ui`
- `demo/src/store` → `electron/src/renderer/store`
- `demo/src/App.tsx`、`main.tsx`、`session.ts`、`desktop.ts`、`desktop-play.ts` 和样式 → `electron/src/renderer`
- `demo/src/engine`、`character`、`keeper`、`ai`、`cards` → `electron/src/core`
- `demo/src/data/packs` → `electron/content/packs`
- `demo/scripts` → `electron/scripts`，同名时保持现有 Electron 脚本并为迁入脚本选取明确名称
- 跨模块测试 → `electron/tests`；模块单元测试随源码移动

迁移不包含 `demo/dist`、`demo/node_modules`、`tsconfig.tsbuildinfo`、浏览器 README/PLAN/DEVLOG、`.env.example`、独立 `package.json`、独立锁文件和浏览器入口配置。

## 5. 依赖与导入边界

统一使用以下别名：

- `@core/*` → `electron/src/core/*`
- `@renderer/*` → `electron/src/renderer/*`
- `@shared/*` → `electron/src/shared/*`
- `@main/*` → `electron/src/main/*`

允许关系：

- main → core、shared
- preload → shared
- renderer → core、shared
- core → core 内部模块
- shared 不依赖 main、renderer 或具体运行时

禁止 main 引用 renderer，禁止 renderer 引用 main，禁止任何源码继续引用 `demo/` 或 `handbook/`。迁移应优先调整导入路径，不改变导出接口和模块行为。

## 6. 构建与开发

`electron/package.json` 成为唯一应用包清单，合并 React、Vite、Tailwind、SQLite、Electron、Bun 测试和 TypeScript 依赖。`electron/vite.config.ts` 构建 `src/renderer`，Electron 主进程构建脚本以 `src/main` 与 `src/preload` 为入口。

开发命令只启动 Electron 和渲染器开发服务器，不再提供浏览器独立入口或 `/ollama` 代理。生产构建将 renderer 写入 Electron 的 `dist/renderer`，主进程继续写入 `dist`。electron-builder 从 `content/packs` 复制模组资源。

根 `package.json` 不再声明 handbook workspace，也不再提供 handbook 或浏览器 Demo 脚本。根目录只保留指向 Electron 工作区的便捷命令；根锁文件中只由 handbook 引入的依赖应随工作区更新移除。

## 7. 删除与文档整理

完成迁移并通过引用检查后删除整个 `demo/` 和 `handbook/`。同步更新根 README、Electron README、实现设计和打包技能中的旧路径。历史设计文档可以保留当时的 `demo/` 路径作为历史记录，不批量改写已经完成的计划；当前说明与可执行命令必须全部指向新路径。

删除前确认 `demo/` 的每个业务目录、测试和模组数据都有明确的新位置。只删除可再生成产物和已迁移内容，不处理与本任务无关的现有工作区改动。

## 8. 迁移顺序

1. 建立 `electron/src` 与 `electron/content` 目标结构，迁移源码和测试。
2. 更新别名与导入，先让新路径下的聚焦测试可加载。
3. 合并依赖、Vite 和 TypeScript 配置，完成 renderer 与 main 构建。
4. 更新开发、内容检查、E2E 和 electron-builder 路径。
5. 运行引用扫描，确认活动代码与配置不再依赖旧目录。
6. 删除 `demo/`、`handbook/` 及重复配置，更新当前文档。
7. 运行完整验证并生成新的 `win-unpacked`。

每一步使用可验证的小批次迁移；如果路径调整暴露真实模块耦合，只做完成归并所需的最小边界修复。

## 9. 验收标准

- 仓库中不存在 `demo/` 与 `handbook/` 目录。
- Electron 工作区可独立安装全部依赖。
- 活动源码、配置、脚本和当前文档不引用 `demo/` 或 `handbook/`。
- 所有现有单元测试迁移后通过。
- 内容包 lint、smoke、keeper、持久化、检查点、gold path 和 Mist Harbor E2E 通过。
- TypeScript 类型检查和生产构建通过。
- 新 `win-unpacked` 启动验证通过，模组资源与原生 SQLite 模块可用。
- 旧存档可按原数据库结构和 IPC 契约重新打开。

## 10. 风险控制

- 先复制/移动并修复引用，验证后才删除旧目录，避免遗漏业务文件。
- 使用 `rg` 扫描跨目录引用和旧命令，不凭目录名称判断文件无用。
- 保持测试与源码同步迁移，避免迁移后失去回归覆盖。
- 打包仅交付 `electron/release` 下的 `win-unpacked` 文件夹；不恢复多格式安装器流程。
- 当前工作区已有改动不纳入本设计文档提交，后续迁移必须逐项核对并保留。
