import hashlib
import json
from pathlib import Path

from tools.embedding.build_dataset import build_dataset


def write_pack(
    root: Path,
    facts: list[dict],
    rooms: list[dict] | None = None,
    records: dict[str, list[dict]] | None = None,
) -> None:
    pack = root / "clock-house"
    pack.mkdir()
    (pack / "facts.json").write_text(json.dumps(facts, ensure_ascii=False), encoding="utf-8")
    if rooms is not None:
        (pack / "rooms.json").write_text(json.dumps(rooms, ensure_ascii=False), encoding="utf-8")
    for name, rows in (records or {}).items():
        (pack / f"{name}.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def all_rows(output_dir: Path) -> list[dict]:
    return [
        row
        for name in ("train", "validation", "test")
        for row in read_jsonl(output_dir / f"{name}.jsonl")
    ]


def test_dataset_has_positive_and_non_matching_negative(tmp_path: Path):
    write_pack(
        tmp_path,
        facts=[
            {"id": "fact.clock", "title": "铜钟停在十一点四十七分"},
            {"id": "fact.note", "title": "便笺指向地下室的暗门"},
        ],
    )

    stats = build_dataset(tmp_path, tmp_path / "out", seed=7)
    rows = all_rows(tmp_path / "out")

    assert stats["documents"] == 2
    assert rows
    assert all(row["positive_id"] != row["negative_id"] for row in rows if row.get("negative_id"))
    assert all(row["source"] == "synthetic-template" for row in rows)


def test_dataset_is_deterministic_and_keeps_groups_in_one_split(tmp_path: Path):
    write_pack(
        tmp_path,
        facts=[{"id": "fact.clock", "title": "铜钟停在十一点四十七分"}],
        rooms=[{"id": "loc.cellar", "title": "地下室", "intro": "墙后传来滴水声"}],
    )

    build_dataset(tmp_path, tmp_path / "first", seed=8503)
    build_dataset(tmp_path, tmp_path / "second", seed=8503)

    for name in ("documents.jsonl", "train.jsonl", "validation.jsonl", "test.jsonl", "manifest.json"):
        first = (tmp_path / "first" / name).read_bytes()
        second = (tmp_path / "second" / name).read_bytes()
        assert hashlib.sha256(first).hexdigest() == hashlib.sha256(second).hexdigest()

    groups_by_split = {
        split: {row["group"] for row in read_jsonl(tmp_path / "first" / f"{split}.jsonl")}
        for split in ("train", "validation", "test")
    }
    assert not (groups_by_split["train"] & groups_by_split["validation"])
    assert not (groups_by_split["train"] & groups_by_split["test"])
    assert not (groups_by_split["validation"] & groups_by_split["test"])


def test_dataset_uses_domain_query_templates(tmp_path: Path):
    write_pack(
        tmp_path,
        facts=[{"id": "fact.note", "title": "便笺指向地下室的暗门"}],
        rooms=[{"id": "loc.cellar", "title": "地下室", "intro": "墙后传来滴水声"}],
        records={
            "npcs": [{"id": "npc.keeper", "title": "守夜人", "line": "他避开了你的目光"}],
            "items": [{"id": "item.key", "title": "生锈的钥匙", "observed": "齿痕沾着泥"}],
        },
    )

    build_dataset(tmp_path, tmp_path / "out", seed=7)

    queries = {row["query"] for row in all_rows(tmp_path / "out")}
    assert "守夜人知道什么？" in queries
    assert "地下室有什么异常？" in queries
    assert "便笺指向地下室的暗门意味着什么？" in queries
    assert "如何到达地下室？" in queries
    assert "生锈的钥匙有什么作用？" in queries
