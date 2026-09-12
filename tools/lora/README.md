# LoRA 微调（Python 侧）

训练只能在 Python 里做，这一层单独放在 `tools/lora/`，不进 Electron 依赖。

**分工：本机负责数据合成与最终部署，GPU 租云端。** 本机没有 NVIDIA 卡，训练跑不动（见下文）。

## 0. 本机装 Ollama（本地推理 + 本地向量化）

```powershell
winget install Ollama.Ollama        # 或官网下载 OllamaSetup.exe
ollama pull qwen2.5:3b-instruct     # 对话底座，约 2GB
ollama pull bge-m3                  # 本地 embedding，约 1.2GB
ollama serve                        # 默认 11434，提供 OpenAI 兼容的 /v1/chat/completions 与 /v1/embeddings
```

对应的 `.env`（在 `electron/.env`）：

```
LC_PROTOCOL=ollama
LC_BASE_URL=http://127.0.0.1:11434
LC_MODEL=qwen2.5:3b-instruct
LC_EMBED_PROTOCOL=ollama
LC_EMBED_BASE_URL=http://127.0.0.1:11434
LC_EMBED_MODEL=bge-m3
```

对话与向量化走同一个本地服务，不需要任何 API Key，也不联网。

## 1. 合成训练数据（全 AI 生成）

```bash
export OPENAI_API_KEY=sk-xxx
export OPENAI_BASE_URL=https://api.deepseek.com/v1   # 任意 OpenAI 兼容接口
export CHAT_MODEL=deepseek-chat

python tools/lora/synth_lora_data.py --total 800 --seeds 40 \
    --lore electron/content/packs --out tools/lora/data
```

世界观语料来自你已经有的卡包 JSON（secret 事实由 RAG 侧过滤，合成时按语料整体使用）。
脚本只依赖标准库，不需要装任何包。产出 `tools/lora/data/train.jsonl` 与 `dataset_info.json`。

## 2. 云端训练（AutoDL / 任意 24GB 单卡）

先在 **无卡模式**（约 0.1 元/时）上传目录、跑通环境，再切 GPU 计费模式：

```bash
bash tools/lora/train_autodl.sh
```

脚本做三件事：装 LLaMA-Factory → `llamafactory-cli train lora_qwen3b.yaml` → `merge_lora.py` 合并。
Qwen2.5-3B · 800 条 · 3 epoch 约 150 步，RTX 3090 上约 15–30 分钟，**单次训练成本 1～2 元**。

## 3. 把模型拉回本地

合并产物 `merged-3b` 约 6GB。三条可选路径，按可靠性排序：

| 路径 | 做法 | 代价 |
| --- | --- | --- |
| A 合并后导出 GGUF（推荐） | 云端 `llama.cpp/convert_hf_to_gguf.py` 转 f16 GGUF → 拉回本地 → `ollama create mydm -f Modelfile --quantize q4_k_m` | 下载约 6GB |
| B 云端量化后下载 | 云端再跑 `llama-quantize` 到 Q4_K_M（约 2GB）再下载 | 需编译 llama.cpp，但下载最快 |
| C 只下载 adapter | 只拉 30MB 的 `adapter_model.safetensors`，本地 llama.cpp 用 `--lora` 挂载 | 依赖 Ollama 对 `ADAPTER` 的支持，版本相关，需验证 |

推荐 A：`ollama create` 自带 `--quantize`，不需要编译任何东西。

## 4. 回 Bench 对比

```bash
bun run bench -- --mode lora      # .env 里 LC_MODEL 指向合并后的本地模型
```

## 期望管理

800 条合成数据训 3B，改的是**表达风格**（语气、格式、节奏），不是推理能力。
跑不出"总分暴涨"很正常；对比时应重点看 consistency 与风格类主观分项。
