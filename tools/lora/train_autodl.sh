#!/usr/bin/env bash
# AutoDL 单卡上一键跑完 Qwen2.5-3B LoRA：装环境 → 训练 → 合并。
#
# 前提：把本地 tools/lora 整个目录传到实例的 /root/autodl-tmp/trpg-lora。
# 省钱要点：先在「无卡模式」（约 0.1 元/时）跑完下面第 1~2 步，
#          再切到 3090/4090 计费模式执行本脚本。
set -euo pipefail

export HF_ENDPOINT=https://hf-mirror.com
source /etc/network_turbo 2>/dev/null || true

WORK=/root/autodl-tmp/trpg-lora
cd "$WORK"

echo "==> 1/3 安装 LLaMA-Factory"
pip install -q -U pip
[ -d LLaMA-Factory ] || git clone --depth 1 https://github.com/hiyouga/LLaMA-Factory.git
pip install -q -e "./LLaMA-Factory[torch,metrics]"

echo "==> 2/3 训练"
llamafactory-cli train lora_qwen3b.yaml

echo "==> 3/3 合并 LoRA"
python merge_lora.py \
  --base Qwen/Qwen2.5-3B-Instruct \
  --adapter saves/qwen2.5-3b-lora-trpg \
  --out /root/autodl-tmp/merged-3b

echo "==> 完成。合并产物：/root/autodl-tmp/merged-3b"
