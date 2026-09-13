# LoRA 领域微调子系统

本目录实现了面向中文 TRPG 主持人风格的 LoRA 微调闭环：训练数据构建、LLaMA-Factory SFT、云端单卡训练、Adapter 合并、本地 Ollama 部署，以及 base/RAG/LoRA 三档评测。训练与 Electron 运行时解耦，桌面应用只通过 OpenAI-compatible 接口选择模型。

## 已实现内容

| 文件 | 作用 |
| --- | --- |
| `data/seeds.jsonl` | 20 条人工校对的冷峻叙事种子，离线扩展时始终保留 |
| `data/train.jsonl` | 人工种子与合成样本合并后的训练集，可直接做 smoke train |
| `data/dataset_info.json` | LLaMA-Factory Alpaca 数据映射 |
| `synth_lora_data.py` | 从模组语料扩展 200–800 条 SFT 数据 |
| `lora_qwen3b.yaml` | Qwen2.5-3B LoRA 训练参数 |
| `train_autodl.sh` | AutoDL 单卡安装、训练、合并入口 |
| `merge_lora.py` | 将 Adapter 合并为标准 Hugging Face 模型 |
| `electron/src/core/ai/lc/provider.ts` | 基座模型与 LoRA 模型动态路由 |
| `electron/scripts/bench.ts` | base/RAG/LoRA 共用数据集评测 |

仓库不提交模型权重、Adapter、云端缓存和密钥。它们属于可再生成的大文件，不是源代码的一部分。

## 最小可运行版本

提交的 20 条样例用于验证数据格式、训练配置和端到端链路，定位是“风格微调 smoke set”，不是宣称已经得到稳定泛化效果。所有输出遵循统一目标：第二人称、冷峻克制、场景推进、必要时提示检定，并以“你要怎么做？”收尾。

在装有 LLaMA-Factory 的环境中：

```bash
cd tools/lora
llamafactory-cli train lora_qwen3b.yaml
```

配置采用 Qwen2.5-3B-Instruct、LoRA rank 16、`q_proj/v_proj`、3 epoch。20 条数据可以快速验证链路；用于正式风格实验时，先扩展数据规模。

## 扩展训练数据

默认的离线扩展不需要 API 或密钥；它只组合内容包中已公开的房间、NPC 台词、物品描述和事实。秘密事实及关联实体不会进入训练集，避免 LLaMA-Factory 映射忽略 `meta` 时泄露给玩家样本。每条模板样本都有 `meta.source: "synthetic-template"` 和按内容包/实体生成的稳定 `meta.group`；人工种子则标记为 `human-authored`。

```powershell
python tools/lora/synth_lora_data.py --offline --total 400 --seed 8503 `
  --lore electron/content/packs --out tools/lora/data
```

该命令会保留 20 条 `seeds.jsonl` 人工种子，并向 `train.jsonl` 追加 400 条确定性的模板样本；`dataset_info.json` 的 `sources` 字段会按实际来源记录数量。输出会拒绝空字段、重复回复、60–220 字范围外的回复、非固定行动钩子结尾，以及替玩家宣告骰点或检定成败的措辞。训练/评估的物理切分留给后续流程；本步骤只提供稳定分组键。

如需让外部模型补充更多候选数据，仍可在仓库根目录设置 OpenAI-compatible 模型服务。密钥只放环境变量，不写入文件：

```powershell
$env:OPENAI_API_KEY="使用新生成的密钥"
$env:OPENAI_BASE_URL="https://api.deepseek.com"
$env:CHAT_MODEL="deepseek-v4-flash"
python tools/lora/synth_lora_data.py --total 400 --seeds 40 `
  --lore electron/content/packs --out tools/lora/data
```

在线生成会覆盖 `data/train.jsonl` 和 `data/dataset_info.json`；正式训练建议人工抽检至少 10%，重点剔除事实冲突、模型自编骰点、半截句和格式漂移。

## AutoDL 单卡训练与合并

把 `tools/lora` 整个目录上传为 `/root/autodl-tmp/trpg-lora`，然后执行：

```bash
bash train_autodl.sh
```

脚本会：

1. 安装 LLaMA-Factory；
2. 根据 `lora_qwen3b.yaml` 训练 Adapter；
3. 调用 `merge_lora.py` 合并到 `/root/autodl-tmp/merged-3b`。

先用无卡模式上传文件和下载依赖，切换 GPU 后再运行训练，结束后立即关机。实际耗时取决于数据规模、显卡和镜像缓存，不在文档里预设成绩。

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
