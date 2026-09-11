# LoRA 微调（Python 侧）

训练只能在 Python 里做，所以这一层单独放在 `tools/lora/`，不进 Electron 依赖。

## 1. 合成训练数据（全 AI 生成）

```bash
export OPENAI_API_KEY=sk-xxx
export OPENAI_BASE_URL=https://api.deepseek.com/v1   # 任意 OpenAI 兼容接口
export CHAT_MODEL=deepseek-chat

python tools/lora/synth_lora_data.py --total 800 --seeds 40 \
    --lore electron/data/lore --out tools/lora/data
```

产出 `tools/lora/data/train.jsonl` 与 `dataset_info.json`。
脚本只依赖标准库（`urllib`），不需要装任何包。

## 2. 训练（AutoDL / 任意 24GB 单卡）

```bash
git clone --depth 1 https://github.com/hiyouga/LLaMA-Factory.git
cd LLaMA-Factory && pip install -e ".[torch,metrics]"
# 把本仓库 tools/lora 挂进去后：
llamafactory-cli train ../../lora_qwen3b.yaml
```

## 3. 合并权重 + 起服务

```bash
llamafactory-cli export ...     # 或用 WebUI 的 Export
python -m vllm.entrypoints.openai.api_server --model <merged> --port 8000
```

## 4. 回 Bench 对比

```bash
LORA_MODEL=qwen2.5-3b-lora LORA_BASE_URL=http://127.0.0.1:8000/v1 bun run bench -- --mode lora
```

## 期望管理

800 条合成数据训 3B，改的是**表达风格**（语气、格式、节奏），不是推理能力。
跑不出"总分暴涨"很正常；对比时应重点看 consistency 与风格类主观分项。
