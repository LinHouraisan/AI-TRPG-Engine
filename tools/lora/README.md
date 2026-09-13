# LoRA 领域微调子系统

本目录实现了面向中文 TRPG 主持人风格的 LoRA 微调闭环：训练数据构建、LLaMA-Factory SFT、云端单卡训练、Adapter 合并、本地 Ollama 部署，以及 base/RAG/LoRA 三档评测。训练与 Electron 运行时解耦，桌面应用只通过 OpenAI-compatible 接口选择模型。

## 已实现内容

| 文件 | 作用 |
| --- | --- |
| `data/seeds.jsonl` | 20 条人工校对的冷峻叙事种子，离线扩展时始终保留 |
| `data/train.jsonl` | 人工种子与合成样本合并后的候选数据 |
| `data/dataset_info.json` | 由 `prepare_dataset.py` 原子生成的 LLaMA-Factory 权威数据映射 |
| `synth_lora_data.py` | 从模组语料扩展 200–800 条 SFT 数据 |
| `lora_qwen3b.yaml` | Qwen2.5-3B LoRA 训练参数 |
| `train_autodl.sh` | AutoDL 单卡环境校验、训练、合并入口（不自动安装依赖） |
| `merge_lora.py` | 将 Adapter 合并为标准 Hugging Face 模型 |
| `electron/src/core/ai/lc/provider.ts` | 基座模型与 LoRA 模型动态路由 |
| `electron/scripts/bench.ts` | base/RAG/LoRA 共用数据集评测 |

仓库不提交模型权重、Adapter、云端缓存和密钥。它们属于可再生成的大文件，不是源代码的一部分。

## 最小可运行版本

提交的 20 条样例用于验证数据格式、训练配置和端到端链路，定位是“风格微调 smoke set”，不是宣称已经得到稳定泛化效果。所有输出遵循统一目标：第二人称、冷峻克制、场景推进、必要时提示检定，并以“你要怎么做？”收尾。

在装有 LLaMA-Factory 的环境中，推荐使用统一入口先重建并检查数据，再启动训练：

```bash
bash tools/lora/train_autodl.sh --check-only
bash tools/lora/train_autodl.sh
```

统一入口按固定 seed 依次执行离线候选生成、family 分组切分、数据注册校验，再在非
`--check-only` 模式执行训练和合并。配置采用 Qwen2.5-3B-Instruct、LoRA rank 16、
`q_proj/v_proj`、3 epoch。

## 扩展训练数据

默认的离线扩展不需要 API 或密钥；它只组合内容包中已公开的房间、NPC 台词、物品描述和事实。
生成器会排除显式关联秘密事实的实体，以及正文命中秘密标题或守秘短语的实体；它不声称能识别
所有经过多步事件才可能揭示秘密的玩法路径。每个模型 `input` 都包含生成该回复所需的玩家可见
场景文本和玩家行动，不包含实体 ID、family 或其他内部元数据。每条模板样本都有
`meta.source: "synthetic-template"` 和按内容包/实体生成的稳定 `meta.group`；人工种子则标记为
`human-authored`。

```powershell
python tools/lora/synth_lora_data.py --offline --total 400 --seed 8503 `
  --lore electron/content/packs --out tools/lora/data
```

该命令会保留 20 条 `seeds.jsonl` 人工种子，并向 `train.jsonl` 追加 400 条确定性的模板样本；
`candidate_manifest.json` 记录候选来源计数。它不会写入或覆盖 `dataset_info.json`。输出会拒绝空字段、
重复回复、60–220 字范围外的回复、非固定行动钩子结尾，以及替玩家宣告骰点或检定成败的措辞。
若不用统一入口，必须继续执行准备步骤，生成训练配置引用的 split 和权威注册表：

```powershell
python tools/lora/prepare_dataset.py --input tools/lora/data/train.jsonl `
  --seeds tools/lora/data/seeds.jsonl --out tools/lora/data --seed 8503
```

如需让外部模型补充更多候选数据，仍可在仓库根目录设置 OpenAI-compatible 模型服务。密钥只放环境变量，不写入文件：

```powershell
$env:OPENAI_API_KEY="使用新生成的密钥"
$env:OPENAI_BASE_URL="https://api.deepseek.com"
$env:CHAT_MODEL="deepseek-v4-flash"
python tools/lora/synth_lora_data.py --total 400 --seeds 40 `
  --lore electron/content/packs --out tools/lora/data
```

在线生成只会覆盖 `data/train.jsonl` 和候选摘要，不会覆盖训练注册表；完成后同样必须运行
`prepare_dataset.py`。正式训练建议人工抽检至少 10%，重点剔除事实冲突、模型自编骰点、半截句和格式漂移。

## 云端单卡训练与合并

当前状态：**云端训练尚未运行**。仓库中没有 Adapter、合并模型、训练日志或
`docs/bench/report-style-*` 报告，也没有可用于简历的训练后指标。下面只是已经过本地数据检查的
可复现执行入口；只有在 GPU 实例真实运行完成后，才能把产物路径和指标补到文档中。

### 前置条件

- Linux + Bash、Python 3.11、Git 和一张 NVIDIA GPU（目标环境为 24GB 显存单卡）；
- 能下载或已缓存 `Qwen/Qwen2.5-3B-Instruct`；私有模型凭证只通过云平台或环境变量提供；
- 安装与当前 CUDA/PyTorch 匹配的 LLaMA-Factory，并记录实际 commit 或版本；
- 上传完整仓库或至少保留 `tools/lora` 与 `electron/content/packs` 的原相对目录。数据切分脚本需要内容包关系来防止同一场景跨集合泄漏。

脚本不会自动安装依赖、上传产物或推送 Git。推荐先在云平台按官方说明创建独立环境，安装完成后确认：

```bash
python --version
nvidia-smi
llamafactory-cli --help
```

不要把 API Key、Hugging Face Token 或云平台密钥写进脚本和仓库。

### 执行步骤

在仓库根目录先做不需要 GPU 的数据与配置检查。该命令会按固定 seed 重新生成 Task 2 的
候选数据、`train.sft.jsonl`、`validation.sft.jsonl`、`test.prompts.jsonl` 和 `manifest.json`，并确认
`dataset_info.json` 中的训练集、验证集注册与 YAML 一致：

```bash
bash tools/lora/train_autodl.sh --check-only
```

切到 GPU 实例并确认前置条件后，运行真实训练：

```bash
bash tools/lora/train_autodl.sh
```

脚本依次执行离线生成、稳定切分、注册校验、`llamafactory-cli train` 和 `merge_lora.py`。
可用 `LORA_DATA_DIR`、`LORA_LORE_ROOT`、`LORA_TOTAL` 和 `LORA_SEED` 显式调整可再生成数据的位置、
公开内容包、模板数量和随机种子；训练 YAML 的 `dataset_dir` 必须指向同一数据目录。默认产物位于：

- Adapter：`tools/lora/saves/qwen2.5-3b-lora-trpg`（来自 YAML 的 `output_dir`）；
- 合并模型：`tools/lora/merged-qwen2.5-3b-trpg`；
- 训练日志：`tools/lora/logs/train-<UTC 时间>.log`。

日志会记录 GPU、训练/验证样本数、实际 CLI 路径和 LLaMA-Factory 的训练输出（包括 epoch、loss
等真实日志字段）。脚本会检查 Adapter 与合并模型的关键文件；目标合并目录已经存在时会拒绝覆盖。
如需将输出放到数据盘，可在调用时设置 `LORA_MERGED_DIR`、`LORA_LOG_DIR`，但不要改写仓库配置：

```bash
LORA_MERGED_DIR=/data/models/trpg-style-merged \
LORA_LOG_DIR=/data/logs/trpg-style \
bash tools/lora/train_autodl.sh
```

如果 `model_name_or_path` 改为本地路径，脚本支持 `~/models/qwen`、`./models/qwen`，也会把确实
存在的 `models/qwen` 识别为相对配置文件的目录，并检查其中的 `config.json`；不存在的普通
`组织名/模型名` 仍按 Hugging Face 仓库 ID 交给 LLaMA-Factory 按实际缓存和网络解析。训练、日志
写入或合并失败时脚本立即退出，不会把半成品当作成功产物。

## 本地部署

推荐在云端把合并模型转换为 GGUF，再拉回本机：

```bash
ollama create trpg-gm-lora -f Modelfile --quantize q4_k_m
```

Electron 侧无需修改链路代码，只需给评测脚本提供模型名和服务地址：

```powershell
$env:LORA_MODEL="trpg-gm-lora"
$env:LORA_BASE_URL="http://127.0.0.1:11434/v1"
bun --cwd electron run bench -- --mode lora
```

`chatModelFrom()` 会在 LoRA 模型存在时切换端点；RAG 检索和规则 Agent 仍复用原有工程边界。

## 评测口径

LoRA 的目标是主持人口吻、结构和节奏，不是增加推理能力。最小验收关注：

- 输出是否保持第二人称和冷峻克制语气；
- 是否给出可行动的新信息，而不是重复玩家输入；
- 需要判定时是否提示检定，但不自行编造骰点；
- 是否以明确行动钩子收尾；
- 相同评测集下，base/RAG/LoRA 的格式遵循率和一致性差异。

最终效果数字只应来自实际训练后的报告；工程实现本身可以独立验证。

### 训练完成后的三档对比

三档必须使用同一份 `electron/data/bench/dataset.jsonl`、同一裁判模型配置和同一评测参数：

- `base`：基座生成，不注入检索上下文；
- `rag`：同一基座生成，并注入当前 JSON 向量索引检索结果；
- `lora`：文风 Adapter/合并模型生成，并沿用与 `rag` 相同的检索边界。

先分别启动实际使用的 OpenAI-compatible 基座与 LoRA 端点，再运行：

```bash
bun --cwd electron run bench -- --mode base
bun --cwd electron run bench -- --mode rag
LORA_MODEL=<实际模型名> LORA_BASE_URL=<实际端点/v1> \
  bun --cwd electron run bench -- --mode lora
```

Electron bench 生成 `docs/bench/report-base.*`、`report-rag.*` 和 `report-lora.*`，衡量固定题集上的
知识、规则、连贯性与检索表现。不要把 `rag` 相对 `base` 的变化写成 LoRA 收益，也不要把裁判分数
等同于确定性格式指标。任一端点调用失败都应先修复并重跑，不保留空回答形成的报告。

文风的确定性对比另用下节命令在 `test.prompts.jsonl` 上运行 base 与 LoRA，生成
`report-style-base.*` 和 `report-style-lora.*`。这两组报告与训练日志、数据 manifest 一起构成
可审计证据；只有全部来自真实运行，才可以据此填写简历数字。

### 确定性文风指标

`evaluate_style.py` 使用同一份 `data/test.prompts.jsonl` 调用 OpenAI-compatible
`/chat/completions` 端点，并在全部样本生成成功后写出 `.json` 和 `.md` 报告。报告保留每条
prompt、参考输出、来源、场景分组和模型原始输出，便于逐条复核；调用失败时不会生成一份假成绩。

```powershell
$env:OPENAI_BASE_URL="http://127.0.0.1:11434/v1"
$env:CHAT_MODEL="qwen2.5:3b"
python tools/lora/evaluate_style.py --data tools/lora/data/test.prompts.jsonl `
  --mode base --out docs/bench/report-style-base

$env:LORA_BASE_URL="http://127.0.0.1:11434/v1"
$env:LORA_MODEL="trpg-gm-lora"
python tools/lora/evaluate_style.py --data tools/lora/data/test.prompts.jsonl `
  --mode lora --out docs/bench/report-style-lora
```

四项指标均由固定文本规则计算：是否出现第二人称“你”、是否严格以“你要怎么做？”收尾、
是否出现“玩家主体 + 掷骰点数或明确检定结果”等代掷表述，以及输出长度是否在 60–220 字符。
“若/如果/当……检定成功或失败”等条件式建议不会计为代掷，NPC 投掷普通物品也不会误报。
条件作用域可跨逗号和顿号，但会在句号、问号、叹号或分号处终止。非法代掷项是明确模式检测，
不是通用语义或施事角色分析。
其中非法代掷率越低越好，其余三项越高越好。纯评分函数对空输出返回四个零值；正式评测会拒绝
空测试集，并且不会写出无意义的报告文件。
这些指标只衡量形式遵循，不判断事实冲突、推理能力或叙事质量；后者仍需现有 bench 和人工复核。
