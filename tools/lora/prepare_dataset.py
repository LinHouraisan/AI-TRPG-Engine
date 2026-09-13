"""将候选 TRPG SFT 数据按场景组切分为训练、验证和评测文件。"""
from __future__ import annotations

import argparse
from collections import defaultdict
import json
from pathlib import Path
import random


SPLIT_RATIOS = (0.8, 0.1, 0.1)
SFT_FIELDS = ("instruction", "input", "output")


def _fact_ids(value: object) -> set[str]:
    if isinstance(value, dict):
        facts = set()
        for key, item in value.items():
            if key in {"fact", "known", "grants", "observeGrants", "knownFacts"}:
                values = item if isinstance(item, list) else [item]
                facts.update(fact for fact in values if isinstance(fact, str) and fact.startswith("fact."))
            else:
                facts.update(_fact_ids(item))
        return facts
    if isinstance(value, list):
        return {fact for item in value for fact in _fact_ids(item)}
    return set()


def build_family_groups(packs_root: Path) -> dict[str, str]:
    """从内容包中显式的实体、场景与事实关联推导稳定 family。"""
    parent: dict[str, str] = {}

    def add(node: str) -> None:
        parent.setdefault(node, node)

    def find(node: str) -> str:
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    def connect(first: str, second: str) -> None:
        add(first)
        add(second)
        parent[find(second)] = find(first)

    for pack_dir in sorted(path for path in packs_root.iterdir() if path.is_dir()):
        pack = pack_dir.name
        records: dict[str, list[dict]] = {}
        for kind, filename in (
            ("room", "rooms.json"),
            ("item", "items.json"),
            ("npc", "npcs.json"),
            ("fact", "facts.json"),
            ("investigation", "investigations.json"),
        ):
            path = pack_dir / filename
            records[kind] = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
            for record in records[kind]:
                if record.get("id"):
                    add(f"{pack}:{kind}:{record['id']}")
        for kind in ("item", "npc", "investigation"):
            for record in records[kind]:
                node = f"{pack}:{kind}:{record['id']}"
                room = record.get("at") or record.get("startAt") or record.get("room")
                if room:
                    connect(node, f"{pack}:room:{room}")
                for fact in _fact_ids(record):
                    connect(node, f"{pack}:fact:{fact}")

    components: dict[str, list[str]] = defaultdict(list)
    for node in parent:
        components[find(node)].append(node)
    return {
        node: f"{node.split(':', 1)[0]}:family:{min(component).rsplit(':', 1)[-1]}"
        for component in components.values()
        for node in component
    }


DEFAULT_FAMILY_GROUPS = build_family_groups(
    Path(__file__).resolve().parents[2] / "electron" / "content" / "packs"
)


def _group_for(row: dict, index: int) -> str:
    meta = row.get("meta") or {}
    group = meta.get("group")
    if group:
        return str(group)
    if all(meta.get(key) for key in ("pack", "kind", "entity_id")):
        return f"{meta['pack']}:{meta['kind']}:{meta['entity_id']}"
    raise ValueError(f"第 {index} 行缺少稳定场景分组")


def _validate_row(row: dict, index: int) -> None:
    if not isinstance(row, dict):
        raise ValueError(f"第 {index} 行必须是对象")
    for field in SFT_FIELDS:
        if not isinstance(row.get(field), str) or not row[field].strip():
            raise ValueError(f"第 {index} 行的 {field} 不能为空")
    if (row.get("meta") or {}).get("visibility") != "player":
        raise ValueError(f"第 {index} 行的 meta.visibility 必须为 player")


def _family_group_for(row: dict, index: int) -> str:
    meta = row.get("meta") or {}
    if meta.get("pack"):
        if meta.get("kind") and meta.get("entity_id"):
            entity_group = f"{meta['pack']}:{meta['kind']}:{meta['entity_id']}"
        elif meta.get("scene_id"):
            scene_id = str(meta["scene_id"])
            kind = next(
                (prefix for prefix in ("room", "item", "npc", "fact", "investigation") if scene_id.startswith(prefix[:3] + ".")),
                "room",
            )
            entity_group = f"{meta['pack']}:{kind}:{scene_id}"
        else:
            entity_group = ""
        if entity_group in DEFAULT_FAMILY_GROUPS:
            return DEFAULT_FAMILY_GROUPS[entity_group]
    if meta.get("family_group"):
        return str(meta["family_group"])
    return _group_for(row, index)


def _split_counts(group_count: int) -> tuple[int, int]:
    if group_count < 3:
        return (group_count, 0)
    validation_count = max(1, round(group_count * SPLIT_RATIOS[1]))
    test_count = max(1, round(group_count * SPLIT_RATIOS[2]))
    if validation_count + test_count >= group_count:
        return (1, 1)
    return validation_count, test_count


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")


def _source_counts(rows: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        source = str((row.get("meta") or {}).get("source", "unknown"))
        counts[source] = counts.get(source, 0) + 1
    return counts


def split_dataset(rows: list[dict], out_dir: Path, seed: int = 8503) -> dict:
    """稳定地按 ``meta.group`` 切分候选行，避免同场景跨数据集泄漏。"""
    grouped: dict[str, list[dict]] = defaultdict(list)
    for index, row in enumerate(rows, 1):
        _validate_row(row, index)
        grouped[_family_group_for(row, index)].append(row)
    if not grouped:
        raise ValueError("没有可切分的候选数据")

    groups = sorted(grouped)
    random.Random(seed).shuffle(groups)
    validation_count, test_count = _split_counts(len(groups))
    validation_groups = set(groups[:validation_count])
    test_groups = set(groups[validation_count : validation_count + test_count])

    split_rows = {
        "train": [row for group in groups if group not in validation_groups | test_groups for row in grouped[group]],
        "validation": [row for group in groups if group in validation_groups for row in grouped[group]],
        "test": [row for group in groups if group in test_groups for row in grouped[group]],
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in ("train", "validation"):
        _write_jsonl(
            out_dir / f"{name}.sft.jsonl",
            [{field: row[field] for field in SFT_FIELDS} for row in split_rows[name]],
        )
    _write_jsonl(
        out_dir / "test.prompts.jsonl",
        [
            {
                "prompt": f"{row['instruction']}\n\n{row['input']}",
                "reference_output": row["output"],
                "source": (row.get("meta") or {}).get("source", "unknown"),
                "group": _family_group_for(row, index),
            }
            for index, row in enumerate(split_rows["test"], 1)
        ],
    )
    manifest = {
        "seed": seed,
        "input_rows": len(rows),
        "splits": {
            name: {
                "rows": len(split_rows[name]),
                "groups": sorted(
                    {_family_group_for(row, index) for index, row in enumerate(split_rows[name], 1)}
                ),
                "sources": _source_counts(split_rows[name]),
            }
            for name in split_rows
        },
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def _read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def load_candidate_rows(candidate_path: Path, seed_path: Path) -> list[dict]:
    """读取候选数据，并补回尚未包含在候选文件中的人工种子。"""
    rows = [{**row, "meta": dict(row.get("meta") or {})} for row in _read_jsonl(candidate_path)]
    known = {(row.get("instruction"), row.get("input"), row.get("output")): row for row in rows}
    for index, seed in enumerate(_read_jsonl(seed_path), 1):
        identity = (seed.get("instruction"), seed.get("input"), seed.get("output"))
        seed_meta = seed.get("meta") or {}
        if identity in known:
            known[identity]["meta"].update(seed_meta)
            continue
        rows.append(
            {
                **seed,
                "meta": {
                    "source": "human-authored",
                    "visibility": "player",
                    "group": f"seed:human:{index}",
                    **seed_meta,
                },
            }
        )
        known[identity] = rows[-1]
    for index, row in enumerate(rows, 1):
        row["meta"]["family_group"] = _family_group_for(row, index)
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="tools/lora/data/train.jsonl")
    parser.add_argument("--seeds", default="tools/lora/data/seeds.jsonl")
    parser.add_argument("--out", default="tools/lora/data")
    parser.add_argument("--seed", type=int, default=8503)
    args = parser.parse_args()

    manifest = split_dataset(load_candidate_rows(Path(args.input), Path(args.seeds)), Path(args.out), args.seed)
    print(json.dumps(manifest["splits"], ensure_ascii=False))


if __name__ == "__main__":
    main()
