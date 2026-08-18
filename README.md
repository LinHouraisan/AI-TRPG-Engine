# AI TRPG Engine

本地优先的 AI 跑团引擎：由 AI 担任主持人（守秘人），带你跑单人的桌上角色扮演游戏。数据全部留在本机，模型可以接 Ollama、LM Studio，也可以用自己的云端密钥。

## 目录结构

| 目录 | 是什么 |
| --- | --- |
| `PRD/` | 需求文档，产品、引擎、内容与规则、技术选型、里程碑、实现计划 |
| `demo/` | 试玩 Demo，Bun + Vite + React + Tailwind，浏览器里就能跑 |
| `handbook/` | 作者手册（Astro），《寄宿公寓账本》的权威数据 |
| `src/`、`src-tauri/` | 现有的 Tauri 桌面程序，正在按 PRD 逐步改造 |

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

- 战役、对话、人物卡、战斗和笔记都存在本机的一个 SQLite 文件里。
- API 密钥进的是操作系统钥匙串，不写进数据库。
- 随包的规则文本只有 5e SRD，本产品与《龙与地下城》没有官方关系。
