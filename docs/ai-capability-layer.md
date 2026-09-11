# AI 能力层：LangChain / RAG / Bench / LoRA

> 分支 `feat/ai-capability-layer`。**全部为新增**，不改动确定性内核，gold hash（`b6506aeb`）不受影响。

## 1. 边界：模型依旧不写事实

内核是确定性的：事件、事实增量、状态哈希都在程序里，模型只做叙述与提案。这一层守住同一条线：

- **检索结果只进 prompt**：命中的记忆文本当上下文，不写回 `MemoryState`，不产生事实；
- **点数只能来自内核 RNG**：LangChain 工具包装 `engine/rng.ts` 的种子掷骰，模型请求掷骰但拿不到"编数"的自由；
- **失败可退回**：链路抛错时调用方沿用原有确定性模板，一场团不会因为模型断线而停。

## 2. 目录

| 路径 | 作用 |
| --- | --- |
| `electron/src/core/ai/lc/provider.ts` | `KeeperConfig` → LangChain `ChatModel`，基座 / LoRA 两档 |
| `electron/src/core/ai/lc/prompts.ts` | 叙述、NPC、规则、裁判四组提示词模板 |
| `electron/src/core/ai/lc/tools.ts` | 掷骰 / 检定工具，内部走内核种子 RNG |
| `electron/src/core/ai/lc/retrieval.ts` | 本地向量索引：建库、检索、JSON 序列化 |
| `electron/src/core/ai/lc/chains.ts` | `narrateTurn` / `npcTurn` / `resolveWithRules` |
| `electron/src/core/ai/lc/lc.test.ts` | 离线单测：确定性掷骰、余弦检索、索引往返 |
| `electron/scripts/build-rag.ts` | 从 `data/lore/*.md` 建索引 → `data/rag-index.json` |
| `electron/scripts/synth-bench.ts` | 用模型合成评测集 → `data/bench/dataset.jsonl` |
| `electron/scripts/bench.ts` | 跑 base / rag / lora 三档，出对比报告 |
| `tools/lora/` | LoRA 数据合成（Python）+ LLaMA-Factory 配置 |

## 3. 运行

新增依赖：`langchain`、`@langchain/core`、`@langchain/openai`（见 `electron/package.json`）。

```bash
cd electron
bun install
bun test src/core/ai/lc          # 离线单测，不需要模型

# 检索库：先把世界观 / 设定文档放进 data/lore/*.md
bun run rag:build

# 评测
bun run bench:synth -- --n 90
bun run bench -- --mode base
bun run bench -- --mode rag
```

报告落在 `docs/bench/report-<mode>.md` 与同名 `.json`。

## 4. RAG 补的是哪一半

长期记忆原本是**结构化条目**（fact / causal / commitment / …），写入靠程序提取。
缺的是"按语义把相关条目找回来"——跨场景、几十回合之前的旧信息。

`retrieval.ts` 只做这一件事：向量化 → 余弦召回 → 把命中文本交给链路当上下文。
向量化默认走本地 Ollama（`bge-m3`），远端 OpenAI 兼容接口同签名可换；索引是纯 JSON，可随存档走。

被 `superseded` / `conflicted` 的条目不进索引——过期记忆被检索出来当事实用，是最难查的一类 bug。

## 5. 规则 Agent 为什么值得单独说

模型最容易犯的错是"自己算点数"。`createRuleTools()` 把掷骰与检定包成工具，
内部调用 `rollFor(seed, turnId, sides)`：

- 同一 `seed + turnId` 重放结果不变 —— 与内核"重掷必须是新回合"是同一条规则；
- 工具返回的是**已算好的结果**，模型只负责决定要不要掷、掷什么。

## 6. LoRA 的定位

风格微调：GM 的语气、叙述格式、收尾句式。数据全 AI 合成，Qwen2.5-3B + LLaMA-Factory，单卡 24GB 约 1–3 小时。
训练完把服务地址填进 `LORA_MODEL` / `LORA_BASE_URL`，`bench --mode lora` 直接对比。

800 条合成数据改不了模型能力，只改表达风格——这是预期，不是失败。

## 7. 已知风险

| 风险 | 处理 |
| --- | --- |
| `createAgent` 属 LangChain 1.x，低版本会导入失败 | 依赖锁定 `langchain@^1.0`；0.3.x 环境换 `langchain-classic` 的等价实现 |
| 本地 bge-m3 未拉取 | `ollama pull bge-m3`；或把 `KeeperConfig.protocol` 设为 `openai_compatible` 走远端 embedding |
| 合成评测集质量参差 | 必须人工抽检 10%，否则 bench 数字不可信 |
| 新增三个依赖 | 未在本机执行 `bun install` / `typecheck`，合入前需本地验证 |
