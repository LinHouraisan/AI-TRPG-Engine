# Electron 桌面外壳

按 [`docs/05-implementation-design/`](../docs/05-implementation-design/README.md) 落地的主进程：窗口、单实例、`window.desktopApi`、`settings.sqlite` + 每场 `campaign.sqlite`。渲染进程是 `demo/` 那张跑团桌，**不许**直连 SQLite。

```bash
cd electron
bun install             # postinstall 会按当前 Electron 版本拉 better-sqlite3 预编译
bun run persist:check   # 不启窗口，验 DDL／迁移／不可变事件
bun run gold            # 主进程再跑寄宿公寓金样，哈希须 b6506aeb
bun run content:pack    # 把 boarding-house 打成 dist-content/*.scenario-pack
bun run content:check   # 打到 /tmp 再 validate（含 zipslip／哈希／缺文件）
bun run rebuild:native  # bun install 跳过预编译时再跑一次
bun run dev             # 拉起 Demo Vite + Electron 窗口
```

`dev.ts` 会清掉 `ELECTRON_RUN_AS_NODE`（Cursor 壳常带这个，Electron 会退化成 Node，`app` 是 `undefined`），Vite 绑 `127.0.0.1:1421`。查询回合用 `turn-ask-<operationId>`，不占下一行动的 `turn-${n}`。

`content:pack` 读 `demo/src/data/packs/<id>/` 的八份 JSON，写成 V1 ZIP（`manifest.json` + `entities/` + `story/` + `world/`）。产物在已忽略的 `electron/dist-content/`，不要提交。`content:check` 只写临时目录。

已经接通：`app:*`、`campaign:*`、`settings:*`、`turn:submitAction`、`operation:get`、`timeline:page`。主进程跑 `playTurn`（路由／裁定／提交／模板叙述），事件进 `campaign.sqlite`。主持人润色仍可在渲染进程做，改不了已落的事实。

云凭据走 Main 的 `CredentialStore`（Electron `safeStorage`），密文 blob 写在 userData/`credentials.json`（`credentialId` / `ciphertext` / `createdAt` / `updatedAt`）。Renderer 只有 `settings:setSecret` / `hasSecret` / `deleteSecret`，没有 `getSecret`。`safeStorage` 不可用时拒绝持久化，只允许进程内会话密钥。`bun run persist:check` 用假 cipher 覆盖 set/has/use/delete、落盘无明文、以及不可用模式。

`src-tauri/` 是旧外壳，不再跟。
