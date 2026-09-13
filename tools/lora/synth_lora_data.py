"""全 AI 合成 LoRA 训练数据：世界观 → 场景种子 → 主持人样本。

用法（需先在 .env 或环境里给 OPENAI_API_KEY / OPENAI_BASE_URL）：
    python tools/lora/synth_lora_data.py --total 800 --seeds 40 \
        --lore electron/content/packs --out tools/lora/data

输出：train.jsonl + dataset_info.json（LLaMA-Factory 直接可读）
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import os
import random
import re
from pathlib import Path

import urllib.request

INSTRUCTION = "你是 TRPG 主持人，根据玩家行动推进剧情。"
ACTION_HOOK = "你要怎么做？"
PROHIBITED_ROLL_TEXT = ("你掷出了", "检定成功", "检定失败")

OPENINGS = (
    "你停下脚步。{detail}潮气贴着皮肤，四周的静默比刚才更沉。",
    "{detail}空气里有股迟来的冷意，像有人刚从这里离开。",
    "你放慢脚步。{detail}细微的声响在远处断了一下，又恢复原状。",
    "昏暗的光线里，{detail}你意识到这里的每件东西都像在等人先开口。",
    "你靠近时，{detail}不安没有立刻变成危险，却已经有了重量。",
    "{detail}周围没有人回答，只有某种痕迹把你的注意力引向更深处。",
    "你暂时压低呼吸。{detail}这份异常并不张扬，反而更难忽视。",
    "灯影摇晃间，{detail}你知道再多看一会儿，可能会错过别的动静。",
)
CLUE_TRANSITIONS = (
    "目前能够确认的是：{clue}。",
    "一条不容忽略的线索浮了出来：{clue}。",
    "你把零散细节拼在一起，得到的事实是：{clue}。",
    "它没有解释全部情况，却指向一个明确的方向：{clue}。",
    "这提醒你，已经公开的记录里写着：{clue}。",
    "你没有急着下结论，只记下了这点：{clue}。",
    "眼前的迹象与一条已知信息对上了：{clue}。",
    "无论谁留下它，都让你看见了：{clue}。",
)
CHECK_PROMPTS = (
    "若要进一步确认，可以进行一次{skill}检定。",
    "想把这条线索查实，需要一次{skill}检定。",
    "你可以凭{skill}检定找出其中的破绽。",
    "若不愿冒进，先做一次{skill}检定会更稳妥。",
    "这一步取决于你的{skill}检定；仓促行动可能留下后患。",
    "你可以直接行动，或先以{skill}检定摸清风险。",
    "要分辨它是否可信，{skill}检定或许能帮上忙。",
    "再往下追查前，进行一次{skill}检定能让你少些盲区。",
)
INPUTS = (
    "我放慢脚步，观察眼前的异常。",
    "我先检查附近有没有能说明情况的痕迹。",
    "我试着把刚发现的线索和已知事实对照。",
    "我不急着触碰它，先判断有没有风险。",
    "我想找出是谁留下了这处异常。",
    "我仔细听周围的动静，再决定下一步。",
    "我向更深处看去，确认线索指向哪里。",
    "我先把这一点记下来，继续寻找能印证它的东西。",
)

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
- 中文，output 80-160 字，第二人称，冷峻克制。

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


@dataclass(frozen=True)
class Scene:
    detail: str
    clue: str
    skill: str
    pack: str
    visibility: str
    kind: str


def build_output(scene: Scene, variant: int) -> str:
    opening = OPENINGS[variant % len(OPENINGS)].format(detail=scene.detail)
    clue = CLUE_TRANSITIONS[variant % len(CLUE_TRANSITIONS)].format(clue=scene.clue)
    check = CHECK_PROMPTS[variant % len(CHECK_PROMPTS)].format(skill=scene.skill)
    return f"{opening}{clue}{check}{ACTION_HOOK}"


def _read_records(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        records = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return records if isinstance(records, list) else []


def _scenes_for_pack(pack_dir: Path) -> list[Scene]:
    facts = _read_records(pack_dir / "facts.json")
    fact_by_id = {fact.get("id"): fact for fact in facts if fact.get("id")}
    public_facts = [fact for fact in facts if fact.get("visibility") == "public" and fact.get("title")]
    fallback_clue = public_facts[0]["title"] if public_facts else "这里仍有需要核实的痕迹"
    scenes: list[Scene] = []

    def add(detail: str, clue: str, skill: str, visibility: str, kind: str) -> None:
        if detail.strip() and clue.strip():
            scenes.append(
                Scene(detail.strip().rstrip("。！？") + "。", clue.strip().rstrip("。！？"), skill, pack_dir.name, visibility, kind)
            )

    for room in _read_records(pack_dir / "rooms.json"):
        title, intro = room.get("title", ""), room.get("intro", "")
        add(f"你来到{title}，{intro}", fallback_clue, "侦查", "player", "room")

    for item in _read_records(pack_dir / "items.json"):
        title, observed = item.get("title", ""), item.get("observed", "")
        granted = fact_by_id.get(item.get("observeGrants"), {})
        clue = granted.get("title") if granted.get("visibility") == "public" else fallback_clue
        add(f"你注意到{title}：{observed}", clue, "侦查", "player", "item")

    for npc in _read_records(pack_dir / "npcs.json"):
        title, line = npc.get("title", ""), npc.get("line", "")
        add(f"{title}对你说：{line}", fallback_clue, "心理学", "player", "npc")

    for investigation in _read_records(pack_dir / "investigations.json"):
        add(
            investigation.get("description", ""),
            fallback_clue,
            investigation.get("defaultSkill") or "侦查",
            "player",
            "investigation",
        )

    for fact in public_facts:
        add("你翻阅到一条已经公开的记录", fact["title"], "图书馆使用", "player", "fact")
    for fact in facts:
        if fact.get("visibility") == "secret" and fact.get("title"):
            add("主持人掌握了一条尚未向玩家公开的信息", fact["title"], "心理学", "keeper", "fact")
    return scenes


def is_valid_sample(row: dict, seen_outputs: set[str]) -> bool:
    output = (row.get("output") or "").strip()
    if not (row.get("instruction") or "").strip() or not (row.get("input") or "").strip():
        return False
    if not 60 <= len(output) <= 220 or not output.endswith(ACTION_HOOK):
        return False
    if output in seen_outputs or any(text in output for text in PROHIBITED_ROLL_TEXT):
        return False
    return True


def synthesize_offline(lore_root: Path, total: int, seed: int) -> list[dict]:
    """从内容包公开信息生成确定性的主持人风格候选数据。"""
    if total < 1:
        return []
    scenes = [scene for pack_dir in sorted(lore_root.iterdir()) if pack_dir.is_dir() for scene in _scenes_for_pack(pack_dir)]
    if not scenes:
        raise ValueError(f"找不到可用内容包：{lore_root}")

    variants = max(len(OPENINGS), (total + len(scenes) - 1) // len(scenes) + 1)
    candidates = [(scene, variant) for scene in scenes for variant in range(variants)]
    random.Random(seed).shuffle(candidates)
    rows: list[dict] = []
    seen_outputs: set[str] = set()
    for scene, variant in candidates:
        row = {
            "instruction": INSTRUCTION,
            "input": INPUTS[variant % len(INPUTS)],
            "output": build_output(scene, variant),
            "meta": {
                "source": "synthetic-template",
                "visibility": scene.visibility,
                "pack": scene.pack,
                "kind": scene.kind,
            },
        }
        if not is_valid_sample(row, seen_outputs):
            continue
        seen_outputs.add(row["output"])
        rows.append(row)
        if len(rows) == total:
            return rows
    raise ValueError(f"内容包只能生成 {len(rows)} 条符合约束的样本，少于请求的 {total} 条")


def _load_seed_rows(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        row["meta"] = {"source": "human-authored", "visibility": "player"}
        rows.append(row)
    return rows


def _write_training_data(out_dir: Path, rows: list[dict], seed_count: int, synthetic_count: int) -> None:
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
                },
                "sources": {
                    "human-authored": {"file_name": "seeds.jsonl", "count": seed_count},
                    "synthetic-template": {"count": synthetic_count},
                },
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--total", type=int, default=800)
    parser.add_argument("--seed", type=int, default=8503, help="离线模板组合的随机种子")
    parser.add_argument("--seeds", type=int, default=40)
    parser.add_argument("--batch", type=int, default=10)
    parser.add_argument("--offline", action="store_true", help="仅用内容包 JSON 合成数据，不调用模型 API")
    parser.add_argument("--lore", default="electron/data/lore")
    parser.add_argument("--out", default="tools/lora/data")
    args = parser.parse_args()

    if args.offline:
        out_dir = Path(args.out)
        seed_path = out_dir / "seeds.jsonl"
        if not seed_path.exists():
            seed_path = Path(__file__).with_name("data") / "seeds.jsonl"
        seed_rows = _load_seed_rows(seed_path)
        synthetic_rows = synthesize_offline(Path(args.lore), total=args.total, seed=args.seed)
        _write_training_data(out_dir, [*seed_rows, *synthetic_rows], len(seed_rows), len(synthetic_rows))
        print(f"[✓] 保留 {len(seed_rows)} 条人工种子，新增 {len(synthetic_rows)} 条模板样本 → {out_dir / 'train.jsonl'}")
        return

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
    _write_training_data(out_dir, rows, seed_count=0, synthetic_count=len(rows))
    print(f"[✓] {len(rows)} 条样本 → {out_dir / 'train.jsonl'}")


if __name__ == "__main__":
    main()
