"""用确定性规则评估 TRPG 主持人输出的文风格式。"""
from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
from typing import Callable, Sequence
from urllib.request import Request, urlopen


ACTION_HOOK = "你要怎么做？"
MIN_OUTPUT_LENGTH = 60
MAX_OUTPUT_LENGTH = 220
_PLAYER = r"(?:你(?:们)?|玩家(?:角色)?|调查员)"
_RESULT = r"(?:检定(?:成功|失败)|判定(?:通过|成功|失败))"
_ROLL_DECLARATION = re.compile(
    rf"{_PLAYER}[^。！？\n]{{0,16}}(?:掷|投)(?:出(?:了)?|得|到)"
    rf"[^。！？\n]{{0,24}}(?:\d+\s*点|[dD]\s*\d+|{_RESULT})"
)
_RESULT_DECLARATION = re.compile(rf"{_PLAYER}[^。！？\n]{{0,16}}{_RESULT}")
_CONDITIONAL_PREFIX = re.compile(r"(?:若|如果|当|假如|倘若)[^，,；;。！？\n]*$")


@dataclass(frozen=True)
class StyleMetrics:
    second_person_rate: float
    action_hook_rate: float
    illegal_roll_rate: float
    length_pass_rate: float


def _contains_illegal_roll(output: str) -> bool:
    for pattern in (_ROLL_DECLARATION, _RESULT_DECLARATION):
        for match in pattern.finditer(output):
            if not _CONDITIONAL_PREFIX.search(output[: match.start()]):
                return True
    return False


def score_outputs(outputs: Sequence[str]) -> StyleMetrics:
    """计算纯文本格式指标；不判断事实正确性或整体内容质量。"""
    if not outputs:
        return StyleMetrics(0.0, 0.0, 0.0, 0.0)

    total = len(outputs)
    normalized = [output.strip() for output in outputs]
    return StyleMetrics(
        second_person_rate=sum("你" in output for output in normalized) / total,
        action_hook_rate=sum(output.endswith(ACTION_HOOK) for output in normalized) / total,
        illegal_roll_rate=sum(_contains_illegal_roll(output) for output in normalized) / total,
        length_pass_rate=sum(
            MIN_OUTPUT_LENGTH <= len(output) <= MAX_OUTPUT_LENGTH for output in normalized
        )
        / total,
    )


def evaluate_rows(rows: Sequence[dict], generate: Callable[[str], str]) -> dict:
    """生成并评分测试行，同时保留复核所需的原始字段与输出。"""
    if not rows:
        raise ValueError("测试数据不能为空")
    samples = []
    for index, row in enumerate(rows, 1):
        prompt = row.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError(f"第 {index} 行的 prompt 不能为空")
        output = generate(prompt)
        samples.append(
            {
                "index": index,
                "prompt": prompt,
                "reference_output": row.get("reference_output"),
                "source": row.get("source"),
                "group": row.get("group"),
                "output": output,
            }
        )

    metrics = score_outputs([sample["output"] for sample in samples])
    return {
        "sample_count": len(samples),
        "metrics": asdict(metrics),
        "samples": samples,
    }


def generate_openai(
    prompt: str,
    *,
    base_url: str,
    model: str,
    api_key: str = "",
    timeout: float = 60.0,
    opener: Callable = urlopen,
) -> str:
    """通过 OpenAI-compatible chat completions 端点生成单条回复。"""
    url = base_url.rstrip("/")
    if not url.endswith("/chat/completions"):
        url += "/chat/completions"
    payload = json.dumps(
        {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.0,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = Request(url, data=payload, headers=headers, method="POST")
    with opener(request, timeout=timeout) as response:
        body = json.loads(response.read().decode("utf-8"))
    try:
        output = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError("生成端点返回格式不符合 OpenAI chat completions 约定") from exc
    if not isinstance(output, str) or not output.strip():
        raise ValueError("生成端点返回了空文本")
    return output


def write_report(
    report: dict,
    out_prefix: Path,
    *,
    mode: str,
    model: str,
    base_url: str,
    data_path: str,
) -> None:
    """把一次已完成生成的真实输出写为机器和人工可读报告。"""
    result = {
        "run": {
            "mode": mode,
            "model": model,
            "base_url": base_url,
            "data": data_path,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
        **report,
    }
    out_prefix.parent.mkdir(parents=True, exist_ok=True)
    out_prefix.with_suffix(".json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    metrics = result["metrics"]
    lines = [
        f"# TRPG 文风评测：{mode}",
        "",
        f"- 模型：`{model}`",
        f"- 端点：`{base_url}`",
        f"- 数据：`{data_path}`",
        f"- 样本数：{result['sample_count']}",
        f"- 第二人称比例：{metrics['second_person_rate']:.4f}",
        f"- 行动钩子比例：{metrics['action_hook_rate']:.4f}",
        f"- 非法代掷比例：{metrics['illegal_roll_rate']:.4f}",
        f"- 长度合格比例：{metrics['length_pass_rate']:.4f}",
        "",
        "> 以上均为确定性文本规则，不衡量事实正确性或整体内容质量。",
        "",
        "## 逐条输出",
        "",
    ]
    for sample in result["samples"]:
        lines.extend(
            [
                f"### {sample['index']}. {sample['group'] or '未分组'}",
                "",
                f"- 来源：`{sample['source'] or 'unknown'}`",
                f"- Prompt：{sample['prompt']}",
                f"- 参考输出：{sample['reference_output'] or ''}",
                f"- 模型原始输出：{sample['output']}",
                "",
            ]
        )
    out_prefix.with_suffix(".md").write_text("\n".join(lines), encoding="utf-8")


def _read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--mode", choices=("base", "rag", "lora"), required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--base-url")
    parser.add_argument("--model")
    parser.add_argument("--api-key")
    parser.add_argument("--timeout", type=float, default=60.0)
    args = parser.parse_args()

    is_lora = args.mode == "lora"
    base_url = args.base_url or os.getenv("LORA_BASE_URL" if is_lora else "OPENAI_BASE_URL")
    model = args.model or os.getenv("LORA_MODEL" if is_lora else "CHAT_MODEL")
    api_key = args.api_key if args.api_key is not None else os.getenv("OPENAI_API_KEY", "")
    if not base_url or not model:
        parser.error("请通过参数或环境变量提供 base URL 和模型名")

    rows = _read_jsonl(args.data)
    report = evaluate_rows(
        rows,
        lambda prompt: generate_openai(
            prompt,
            base_url=base_url,
            model=model,
            api_key=api_key,
            timeout=args.timeout,
        ),
    )
    write_report(
        report,
        args.out,
        mode=args.mode,
        model=model,
        base_url=base_url,
        data_path=str(args.data),
    )
    print(json.dumps(report["metrics"], ensure_ascii=False))


if __name__ == "__main__":
    main()
