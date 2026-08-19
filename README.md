# AI TRPG Engine

本地优先的 AI 跑团引擎：由 AI 担任主持人（守秘人），带你跑单人的桌上角色扮演游戏。数据全部留在本机，模型可以接 Ollama、LM Studio，也可以用自己的云端密钥。

## 目录结构

| 目录 | 是什么 |
| --- | --- |
| `docs/` | 逻辑架构（00–04）与 [V1 模块实现设计](docs/05-implementation-design/README.md)（Draft） |
| `PRD/` | 需求文档；物理规格以 `docs/05` 为准，本目录记录仓库现状与差距 |
| `demo/` | 事件内核与跑团桌的可运行切片（浏览器，不依赖 Tauri） |
| `handbook/` | 作者手册（Astro），《寄宿公寓账本》的权威数据 |
| `src/`、`src-tauri/` | 旧 Tauri 聊天外壳：渲染进程直连 SQLite，工具会写库。**不是**当前权威内核 |

## 运行桌面程序

需要先装好 [Bun](https://bun.sh)、[Rust](https://www.rust-lang.org/tools/install)，以及 Tauri 的[环境依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
bun install
bun run tauri dev
```

打开**设置**，选一个模型供应商，然后从侧栏创建战役。

本地默认走 Ollama 的 `http://127.0.0.1:11434/v1`，请挑一个支持工具调用的模型（Llama 3.1 8B 以上、Qwen 2.5 之类）。

## 运行试玩 Demo

```bash
cd demo
bun install
cp .env.example .env.local   # 填上本地 Ollama 的地址
bun run dev
```

Demo 不依赖 Tauri，直接在浏览器里跑。守秘人叙述接本地 Ollama，把它关掉之后退回确定性模板，照样能玩完整条路径。详见 [demo/README.md](demo/README.md) 和 [demo/PLAN.md](demo/PLAN.md)。

## 说明

- **权威内核在 `demo/`**：事件只追加、重放对账、主持人写不了事实。桌面程序的战役／对话／人物表是旧聊天模型，读档不要拿它当事实源。
- V1.0 的目标形态见 [`docs/05-implementation-design/`](docs/05-implementation-design/README.md)：主进程管库，渲染进程只走 IPC。正式分发目标是 Windows x64；当前 Tauri／macOS 流只服务开发。
- Demo 与桌面的 API 密钥都不进数据库。桌面走系统钥匙串；Demo 接本地 Ollama，默认不存云端密钥。
- 随包的规则文本只有 5e SRD，本产品与《龙与地下城》没有官方关系。试玩切片走的是《克苏鲁的呼唤》式百分规则，文本是自写的。
