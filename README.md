# AI TRPG Engine

本地优先的 AI 跑团引擎：由 AI 担任主持人（守秘人），带你跑单人的桌上角色扮演游戏。数据全部留在本机，模型可以接 Ollama、LM Studio，也可以用自己的云端密钥。

## 目录结构

| 目录 | 是什么 |
| --- | --- |
| `docs/` | 逻辑架构（00–04）与 [V1 模块实现设计](docs/05-implementation-design/README.md)（Draft） |
| `PRD/` | 需求文档；物理规格以 `docs/05` 为准，本目录记录仓库现状与差距 |
| `electron/` | 唯一应用工作区：渲染器、内核、主进程、内容、测试与 Windows 打包 |

## 运行桌面程序（Electron）

```bash
bun install --ignore-scripts
bun run desktop:check
bun run desktop
```

Windows 解包版使用 `bun run package:win` 生成到 `electron/release/win-unpacked/`。

## 说明

- **权威内核在 `electron/src/core`**：Electron 通过主进程 `turn:submitAction` 提交行动，主持人写不了事实。
- V1.0 见 [`docs/05-implementation-design/`](docs/05-implementation-design/README.md)。外壳已锁定 Electron。正式分发目标是 Windows x64。
- API 密钥不进数据库，桌面使用系统安全存储。
- 随包的规则文本只有 5e SRD，本产品与《龙与地下城》没有官方关系。试玩切片走的是《克苏鲁的呼唤》式百分规则，文本是自写的。
