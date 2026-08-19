# Electron 桌面外壳

按 [`docs/05-implementation-design/`](../docs/05-implementation-design/README.md) 落地的主进程：窗口、单实例、`window.desktopApi`、`settings.sqlite` + 每场 `campaign.sqlite`。渲染进程是 `demo/` 那张跑团桌，**不许**直连 SQLite。

```bash
cd electron
bun install
bun run persist:check   # 不启窗口，验 DDL／迁移／不可变事件
bun run dev             # 拉起 Demo Vite + Electron 窗口
```

已经接通：`app:*`、`campaign:*`、`settings:*`。`turn:submitAction` 等仍返回 `IPC_METHOD_UNAVAILABLE`——回合内核还在 Demo 进程里，下一步才搬进主进程。

`src-tauri/` 是旧外壳，不再跟。
