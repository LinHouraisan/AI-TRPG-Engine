# Electron 桌面外壳

按 [`docs/05-implementation-design/`](../docs/05-implementation-design/README.md) 落地的主进程：窗口、单实例、`window.desktopApi`、`settings.sqlite` + 每场 `campaign.sqlite`。渲染进程是 `demo/` 那张跑团桌，**不许**直连 SQLite。

```bash
cd electron
bun install
bun run persist:check   # 不启窗口，验 DDL／迁移／不可变事件
bun run dev             # 拉起 Demo Vite + Electron 窗口
```

已经接通：`app:*`、`campaign:*`、`settings:*`、`turn:submitAction`、`operation:get`、`timeline:page`。主进程跑 `playTurn`（路由／裁定／提交／模板叙述），事件进 `campaign.sqlite`。主持人润色仍可在渲染进程做，改不了已落的事实。

`src-tauri/` 是旧外壳，不再跟。
