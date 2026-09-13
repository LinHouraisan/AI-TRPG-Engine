import hashlib
import json
from pathlib import Path

from tools.embedding.build_dataset import build_dataset, split_name


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


def test_explicit_negatives_stay_in_the_positive_split(tmp_path: Path):
    write_pack(
        tmp_path,
        facts=[{"id": f"fact.{index}", "title": f"线索 {index}"} for index in range(50)],
    )

    build_dataset(tmp_path, tmp_path / "out", seed=7)

    for split in ("train", "validation", "test"):
        for row in read_jsonl(tmp_path / "out" / f"{split}.jsonl"):
            assert split_name(row["group"]) == split
            if row["negative_id"]:
                assert split_name(f"clock-house:{row['negative_id']}") == split


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
        rooms=[
            {"id": "loc.hall", "title": "门厅", "intro": "门缝透出冷风", "exits": [{"to": "loc.cellar", "via": "铁门"}]},
            {"id": "loc.cellar", "title": "地下室", "intro": "墙后传来滴水声"},
        ],
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


def test_document_text_preserves_structured_fields(tmp_path: Path):
    write_pack(
        tmp_path,
        facts=[],
        records={
            "story": [
                {
                    "id": "node.escape",
                    "title": "逃离",
                    "doneWhen": {"not": {"flag": "ending.ready"}},
                    "failedWhen": {"clockGte": 47},
                }
            ],
            "conditions": [
                {
                    "id": "cond.alarm",
                    "title": "警报",
                    "once": False,
                    "when": {"not": {"known": "fact.safe"}},
                }
            ],
            "locks": [{"id": "lock.cellar", "title": "地下室铁门", "minutes": 7, "portable": False}],
        },
    )

    build_dataset(tmp_path, tmp_path / "out", seed=7)

    documents = {row["title"]: row["text"] for row in read_jsonl(tmp_path / "out" / "documents.jsonl")}
    assert '"doneWhen":{"not":{"flag":"ending.ready"}}' in documents["逃离"]
    assert '"failedWhen":{"clockGte":47}' in documents["逃离"]
    assert '"once":false' in documents["警报"]
    assert '"when":{"not":{"known":"fact.safe"}}' in documents["警报"]
    assert '"minutes":7' in documents["地下室铁门"]
    assert '"portable":false' in documents["地下室铁门"]


def test_one_way_route_query_uses_destination_with_incoming_route(tmp_path: Path):
    write_pack(
        tmp_path,
        facts=[],
        rooms=[
            {"id": "loc.hall", "title": "门厅", "intro": "门缝透出冷风", "exits": [{"to": "loc.cellar", "via": "铁门"}]},
            {"id": "loc.cellar", "title": "地下室", "intro": "墙后传来滴水声"},
        ],
    )

    build_dataset(tmp_path, tmp_path / "out", seed=7)

    route_row = next(row for row in all_rows(tmp_path / "out") if row["query"] == "如何到达地下室？")
    assert route_row["positive_id"].endswith("loc.cellar")
    assert "可从门厅经由铁门到达" in route_row["positive"]


def test_authored_route_phrase_does_not_create_route_query(tmp_path: Path):
    write_pack(
        tmp_path,
        facts=[],
        rooms=[{"id": "loc.attic", "title": "阁楼", "intro": "到达方式：未知"}],
    )

    build_dataset(tmp_path, tmp_path / "out", seed=7)

    assert "如何到达阁楼？" not in {row["query"] for row in all_rows(tmp_path / "out")}
