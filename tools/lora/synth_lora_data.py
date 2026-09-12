"""全 AI 合成 LoRA 训练数据：世界观 → 场景种子 → 主持人样本。

用法（需先在 .env 或环境里给 OPENAI_API_KEY / OPENAI_BASE_URL）：
    python tools/lora/synth_lora_data.py --total 800 --seeds 40 \
        --lore electron/data/lore --out tools/lora/data

输出：train.jsonl + dataset_info.json（LLaMA-Factory 直接可读）
"""
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

import urllib.request

INSTRUCTION = "你是 TRPG 主持人，根据玩家行动推进剧情。"

SEED_PROMPT = (
    "为以下世界观生成 {n} 个互不重复的场景种子（每个 15-30 字，一行一个，不要编号）：\n\n{lore}"
)

SAMPLE_PROMPT = """你是 TRPG 数据生成器。

世界设定：
{lore}

场景种子：{seed}

要求：
- input 是玩家的一句话行动描述，覆盖探索/战斗/社交/解谜/陷阱/抉择；
- output 是主持人回复，格式固定：场景描写 → 检定提示（如需）→ "你要怎么做？"；
- 中文，output 120-280 字，第二人称，冷峻克制。

只输出 JSON 数组，共 {n} 项，每项字段：instruction, input, output。
instruction 固定为"{instruction}"。"""


def chat(messages: list[dict], temperature: float = 1.0) -> str:
    base = (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    payload = {
        "model": os.getenv("CHAT_MODEL") or "gpt-4o-mini",
        "messages": messages,
        "temperature": temperature,
    }
    request = urllib.request.Request(
        f"{base}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {os.getenv('OPENAI_API_KEY', '')}",
        },
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        body = json.loads(response.read().decode("utf-8"))
    return body["choices"][0]["message"]["content"]


def extract_json_array(text: str) -> list:
    start, end = text.find("["), text.rfind("]")
    if start < 0 or end <= start:
        raise ValueError("模型没有返回数组")
    return json.loads(text[start : end + 1])


def load_lore(path: Path, max_chars: int = 4000) -> str:
    """读语料：目录里找 md/txt，卡包是 JSON 时按字符串字段抽平。"""
    if path.is_dir():
        files = sorted([*path.glob("*.md"), *path.glob("*.txt"), *path.glob("*.json")])
    else:
        files = [path]
    if not files:
        raise SystemExit(f"找不到语料：{path}")
    return "\n\n".join(_as_text(f) for f in files)[:max_chars]


def _as_text(f: Path) -> str:
    raw = f.read_text(encoding="utf-8")
    if f.suffix != ".json":
        return raw
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return raw
    return json.dumps(data, ensure_ascii=False, indent=1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--total", type=int, default=800)
    parser.add_argument("--seeds", type=int, default=40)
    parser.add_argument("--batch", type=int, default=10)
    parser.add_argument("--lore", default="electron/data/lore")
    parser.add_argument("--out", default="tools/lora/data")
    args = parser.parse_args()

    lore = load_lore(Path(args.lore))
    seeds = [
        re.sub(r"^[\s\-0-9.]+", "", line)
        for line in chat(
            [{"role": "user", "content": SEED_PROMPT.format(n=args.seeds, lore=lore)}]
        ).splitlines()
        if line.strip()
    ]
    print(f"[i] 场景种子 {len(seeds)} 个")

    rows: list[dict] = []
    seen: set[str] = set()
    for i, seed in enumerate(seeds, 1):
        if len(rows) >= args.total:
            break
        try:
            batch = extract_json_array(
                chat(
                    [
                        {
                            "role": "user",
                            "content": SAMPLE_PROMPT.format(
                                lore=lore, seed=seed, n=args.batch, instruction=INSTRUCTION
                            ),
                        }
                    ]
                )
            )
        except Exception as error:  # 单批失败不该中断整轮
            print(f"[!] 种子 {i} 生成失败，跳过：{error}")
            continue
        for item in batch:
            out = (item.get("output") or "").strip()
            inp = (item.get("input") or "").strip()
            if not out or not inp or out in seen:
                continue
            seen.add(out)
            rows.append({"instruction": INSTRUCTION, "input": inp, "output": out})
        print(f"[{i}/{len(seeds)}] 累计 {len(rows)} 条")

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / "train.jsonl").open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    (out_dir / "dataset_info.json").write_text(
        json.dumps(
            {
                "trpg_dm": {
                    "file_name": "train.jsonl",
                    "columns": {"prompt": "instruction", "query": "input", "response": "output"},
                }
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"[✓] {len(rows)} 条样本 → {out_dir / 'train.jsonl'}")


if __name__ == "__main__":
    main()
