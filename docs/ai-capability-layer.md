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
| `electron/scripts/lib/lc-config.ts` | 脚本侧配置：`.env` → `KeeperConfig`，对话与向量化分开 |
| `electron/scripts/build-rag.ts` | 从 `content/packs/*/` 建索引 → `data/rag-index.json`（排除 secret） |
| `electron/scripts/synth-bench.ts` | 用模型合成评测集 → `data/bench/dataset.jsonl` |
| `electron/scripts/bench.ts` | 跑 base / rag / lora 三档，出对比报告 |
| `tools/local/setup-ollama.ps1` | 本地推理服务一键搭建：装 Ollama、拉模型、生成 `.env` |
| `tools/lora/` | 数据合成 + 云端训练 / 合并（本机无 NVIDIA 卡，训练只能上云） |

## 3. 运行

新增依赖：`langchain`、`@langchain/core`、`@langchain/openai`（见 `electron/package.json`）。

### 3.1 起本地模型服务

```powershell
.\tools\local\setup-ollama.ps1 -WriteEnv
```

装 Ollama、拉 `qwen2.5:3b-instruct` + `bge-m3`，并写入 `electron/.env`。
本机无 NVIDIA 显卡，推理走 CPU，不需要 API Key，也不联网。

对话与向量化**分开配置**，因为 DeepSeek 等部分厂商不提供 embeddings 接口：

```
LC_*         对话
LC_EMBED_*   向量化
```

两边都支持 `ollama` 与 `openai_compatible` 两种 protocol，可任意组合
（例：对话走云端 API、向量化走本地 bge-m3）。

### 3.2 建索引与评测

```bash
cd electron
bun install
bun test src/core/ai/lc          # 离线单测，不需要模型

bun run rag:build                # 语料来自 content/packs/*/

bun run bench:synth -- --n 90    # 合成评测集（必须人工抽检 10%）
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
同一条边界往下延伸：RAG 索引**不收 secret 事实**。
否则等于绕开 `keeper/guard.ts` 那条带测试盯着的"秘密不得进叙述"不变量。
建库后逐条核对过，9 条 secret 事实一条都不在索引里。

## 5. 规则 Agent 为什么值得单独说

模型最容易犯的错是"自己算点数"。`createRuleTools()` 把掷骰与检定包成工具，
内部调用 `rollFor(seed, turnId, sides)`：

- 同一 `seed + turnId` 重放结果不变 —— 与内核"重掷必须是新回合"是同一条规则；
- 工具返回的是**已算好的结果**，模型只负责决定要不要掷、掷什么。

这条主张是可以验证的：bench 会用同样的 seed 重算一遍，看回答里的点数能否对上，
报告里体现为「点数溯源率」。对不上的情况有两种 —— 模型编数，或者改用 `roll_dice`
（随机同样是确定的，只是取的 key 不同）。这个指标因此偏保守：宁可少算，不多算。

## 6. LoRA 的定位

风格微调：GM 的语气、叙述格式、收尾句式。数据全 AI 合成，Qwen2.5-3B + LLaMA-Factory。

**本机不能训练**——没有 NVIDIA 显卡（AMD 780M 集成显卡，无 CUDA），微调必须租云端 GPU（AutoDL 单卡 24GB 约 ¥1.3–1.9/时，一次训练 15–30 分钟）。
链路是：本机合成数据 → 云端训练合并 → GGUF 拉回本机 → `ollama create --quantize q4_k_m` → `bench --mode lora` 对比。
详见 `tools/lora/README.md` 与 `tools/lora/train_autodl.sh`。

800 条合成数据改不了模型能力，只改表达风格——这是预期，不是失败。

## 7. 已知风险

| 风险 | 处理 |
| --- | --- |
| `createAgent` 属 LangChain 1.x，低版本会导入失败 | 依赖锁定 `langchain@^1.0`；0.3.x 环境换 `langchain-classic` 的等价实现 |
| 本地 CPU 推理慢，bench 可能跑 1 小时以上 | 换 1.5B 模型，或用 `--limit 60` 先验证流程 |
| 合成评测集质量参差 | 必须人工抽检 10%，否则 bench 数字不可信 |
| 云 GPU 忘关机持续计费 | 装环境与下载务必用「无卡模式」，跑完立即关机 |
| 全量 `bun test` 有 2 个既有 flaky | `turns-race` / `turns-opening` 并行时为竞态失败，单独重跑全绿，与本次改动无关 |
