# Electron 应用工作区

完整桌面应用位于此处：`src/main`、`src/preload`、`src/shared`、`src/renderer`、`src/core`，以及内容、SQL、测试和打包脚本。渲染进程不直连 SQLite。

```bash
cd electron
bun install             # postinstall 会按当前 Electron 版本拉 better-sqlite3 预编译
bun run persist:check   # 不启窗口，验 DDL／迁移／不可变事件
bun run gold            # 主进程再跑寄宿公寓金样，哈希须 b6506aeb
bun run typecheck       # 检查生产源码
bun run test            # 隔离运行完整测试套件
bun run build           # 构建渲染器与主进程
bun run package:win     # 只生成 Windows x64 win-unpacked
bun run content:pack    # 把 boarding-house 打成 dist-content/*.scenario-pack
bun run content:check   # 打到 /tmp 再 validate（含 zipslip／哈希／缺文件）
bun run rebuild:native  # bun install 跳过预编译时再跑一次
bun run dev             # 拉起 Vite + Electron 窗口
```

`dev.ts` 会清掉 `ELECTRON_RUN_AS_NODE`（Cursor 壳常带这个，Electron 会退化成 Node，`app` 是 `undefined`），Vite 绑 `127.0.0.1:1421`。查询回合用 `turn-ask-<operationId>`，不占下一行动的 `turn-${n}`。

`content:pack` 读 `content/packs/<id>/` 的八份 JSON，写成 V1 ZIP（`manifest.json` + `entities/` + `story/` + `world/`）。产物在已忽略的 `dist-content/`，不要提交。`content:check` 只写临时目录。

已经接通：`app:*`、`campaign:*`、`settings:*`、`turn:submitAction`、`operation:get`、`timeline:page`。主进程跑 `playTurn`（路由／裁定／提交／模板叙述），事件进 `campaign.sqlite`。主持人润色仍可在渲染进程做，改不了已落的事实。

主持人菜单「调试后台任务」只影响渲染进程记录栏：用确定性 after-commit 重放画 Information / Director / Memory，**不再调一次模型**。live 仍只在主进程跑。默认关。

## 回合审计与数据精选

每个正式回合的路由、上下文清单、模型调用、规则提交、质量守卫和最终叙事会按同一 `traceId` 写入该战役的 `campaign.sqlite`。当回复不符合上下文时，点击叙事旁的“不满意”，系统会汇总因果链并按结构化证据给出初步诊断；它只记录和入池，不重新生成回复，也不回滚已经提交的游戏状态。

候选数据先进入 `pending_review`。人工复核后可标记为 `reviewed`、`curated` 或 `discarded`；只有完整审计且已精选的数据可以导出。坏回复不能直接作为 SFT 答案：SFT 和偏好数据都必须填写人工修正版，偏好数据会同时保留原回复和修正版。导出后状态为 `exported`。

导出 JSONL 与批次清单：

```powershell
bun run audit:export --campaign <campaign.sqlite> --out <cases.jsonl> --manifest <cases.manifest.json>
```

审计库可能包含完整对话、检索来源和状态摘要，应按敏感业务数据管理。API Key、Authorization 头和凭据字段不会写入审计或导出；标为 `secret` / `gm_only` 的程序数据在审计、备份、回看和数据集导出中只保留受控来源元数据，不保留正文。当前版本不包含浏览器内存审计模式，也不包含本地 Judge 自动评分。

云凭据走 Main 的 `CredentialStore`（Electron `safeStorage`），密文 blob 写在 userData/`credentials.json`（`credentialId` / `ciphertext` / `createdAt` / `updatedAt`）。Renderer 只有 `settings:setSecret` / `hasSecret` / `deleteSecret`，没有 `getSecret`。`safeStorage` 不可用时拒绝持久化，只允许进程内会话密钥。`bun run persist:check` 用假 cipher 覆盖 set/has/use/delete、落盘无明文、以及不可用模式。
