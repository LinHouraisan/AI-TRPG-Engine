"""把 LoRA adapter 合并回基座，输出标准 HF 模型目录。

在租来的 GPU 实例上跑；合并本身 CPU 也能做（3B 约占用 7GB 内存）。
"""
import argparse

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

parser = argparse.ArgumentParser()
parser.add_argument("--base", required=True)
parser.add_argument("--adapter", required=True)
parser.add_argument("--out", required=True)
parser.add_argument("--device", default="auto")
args = parser.parse_args()

model = AutoModelForCausalLM.from_pretrained(
    args.base, torch_dtype=torch.bfloat16, device_map=args.device
)
model = PeftModel.from_pretrained(model, args.adapter)
model = model.merge_and_unload()
model.save_pretrained(args.out, safe_serialization=True)
AutoTokenizer.from_pretrained(args.base).save_pretrained(args.out)
print(f"merged -> {args.out}")
