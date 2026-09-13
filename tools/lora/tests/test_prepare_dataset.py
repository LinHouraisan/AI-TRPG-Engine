from pathlib import Path
import json
import sys

import pytest


LORA_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(LORA_ROOT))

from prepare_dataset import load_candidate_rows, split_dataset


def _row(group: str, number: int, family_group: str | None = None) -> dict:
    return {
        "instruction": "主持人",
        "input": f"行动 {group} {number}",
        "output": f"回应 {group} {number}",
        "meta": {
            "source": "synthetic-template",
            "visibility": "player",
            "pack": "manor",
            "kind": "room",
            "entity_id": group,
            "group": f"manor:room:{group}",
            **({"family_group": family_group} if family_group else {}),
        },
    }


FIXTURE_ROWS = [
    *[_row("hall", number) for number in range(2)],
    *[_row("study", number) for number in range(2)],
    *[_row("cellar", number) for number in range(2)],
    *[_row("attic", number) for number in range(2)],
    *[_row("garden", number) for number in range(2)],
    {
        "instruction": "主持人",
        "input": "人工种子",
        "output": "人工回应",
        "meta": {"source": "human-authored", "visibility": "player", "group": "seed:human:1"},
    },
]
GROUP_BY_OUTPUT = {row["output"]: row["meta"]["group"] for row in FIXTURE_ROWS}


def _rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def groups_in(path: Path) -> set[str]:
    return {GROUP_BY_OUTPUT[row["output"]] for row in _rows(path)}


def test_scene_group_stays_in_one_split(tmp_path: Path):
    split_dataset(FIXTURE_ROWS, tmp_path, seed=8503)

    groups = {name: groups_in(tmp_path / f"{name}.sft.jsonl") for name in ("train", "validation")}
    test_groups = {row["group"] for row in _rows(tmp_path / "test.prompts.jsonl")}

    assert groups["train"].isdisjoint(groups["validation"])
    assert groups["train"].isdisjoint(test_groups)
    assert groups["validation"].isdisjoint(test_groups)


def test_sft_rows_are_nonempty_alpaca_records_without_metadata(tmp_path: Path):
    split_dataset(FIXTURE_ROWS, tmp_path, seed=8503)

    for name in ("train", "validation"):
        for row in _rows(tmp_path / f"{name}.sft.jsonl"):
            assert set(row) == {"instruction", "input", "output"}
            assert all(row[field].strip() for field in row)


def test_test_prompts_keep_reference_source_and_group(tmp_path: Path):
    split_dataset(FIXTURE_ROWS, tmp_path, seed=8503)

    test_rows = _rows(tmp_path / "test.prompts.jsonl")

    assert test_rows
    assert all(set(row) == {"prompt", "reference_output", "source", "group"} for row in test_rows)
    assert all(row["prompt"].strip() and row["reference_output"].strip() for row in test_rows)


def test_seed_file_is_added_when_missing_from_candidate_data(tmp_path: Path):
    candidate_path = tmp_path / "train.jsonl"
    seed_path = tmp_path / "seeds.jsonl"
    candidate_path.write_text(json.dumps(_row("hall", 0), ensure_ascii=False) + "\n", encoding="utf-8")
    seed_path.write_text(
        json.dumps(
            {"instruction": "主持人", "input": "人工种子", "output": "人工回应"}, ensure_ascii=False
        )
        + "\n",
        encoding="utf-8",
    )

    rows = load_candidate_rows(candidate_path, seed_path)

    assert [row["meta"]["group"] for row in rows] == ["manor:room:hall", "seed:human:1"]


def test_seed_metadata_enriches_matching_candidate_row(tmp_path: Path):
    candidate_path = tmp_path / "train.jsonl"
    seed_path = tmp_path / "seeds.jsonl"
    candidate = {
        "instruction": "主持人",
        "input": "人工种子",
        "output": "人工回应",
        "meta": {"source": "human-authored", "visibility": "player", "group": "seed:human:1"},
    }
    seed = {
        "instruction": "主持人",
        "input": "人工种子",
        "output": "人工回应",
        "meta": {"family_group": "manor:scene:clock", "pack": "manor", "entity_id": "clock"},
    }
    candidate_path.write_text(json.dumps(candidate, ensure_ascii=False) + "\n", encoding="utf-8")
    seed_path.write_text(json.dumps(seed, ensure_ascii=False) + "\n", encoding="utf-8")

    rows = load_candidate_rows(candidate_path, seed_path)

    assert rows[0]["meta"]["family_group"] == "manor:scene:clock"


def test_different_entity_groups_in_one_family_stay_in_one_split(tmp_path: Path):
    rows = [
        _row("e", 0, family_group="manor:scene:clock"),
        _row("g", 0, family_group="manor:scene:clock"),
        *[_row(name, 0) for name in ("a", "b", "c", "d", "f", "h", "i", "j")],
    ]
    split_dataset(rows, tmp_path, seed=8503)

    split_by_output = {
        row.get("output", row.get("reference_output")): name
        for name, path in {
            "train": tmp_path / "train.sft.jsonl",
            "validation": tmp_path / "validation.sft.jsonl",
            "test": tmp_path / "test.prompts.jsonl",
        }.items()
        for row in _rows(path)
    }

    assert split_by_output["回应 e 0"] == split_by_output["回应 g 0"]


def test_non_player_candidate_is_rejected_before_sft_metadata_is_removed(tmp_path: Path):
    keeper_row = _row("keeper", 0)
    keeper_row["meta"]["visibility"] = "keeper"

    with pytest.raises(ValueError, match="visibility.*player"):
        split_dataset([_row("hall", 0), keeper_row], tmp_path, seed=8503)


def test_committed_human_seeds_have_family_metadata():
    rows = load_candidate_rows(LORA_ROOT / "data" / "train.jsonl", LORA_ROOT / "data" / "seeds.jsonl")
    human_rows = [row for row in rows if row["meta"]["source"] == "human-authored"]

    assert len(human_rows) == 20
    assert all(row["meta"].get("family_group") for row in human_rows)
    assert all(row["meta"].get("pack") and row["meta"].get("scene_id") for row in human_rows)


def test_seed_and_template_with_matching_scene_metadata_share_a_split(tmp_path: Path):
    template = {
        **_row("template", 0),
        "output": "模板车厢",
        "meta": {
            "source": "synthetic-template",
            "visibility": "player",
            "pack": "mist-harbor",
            "kind": "room",
            "entity_id": "loc.carriage",
            "group": "mist-harbor:room:loc.carriage",
        },
    }
    seed = {
        **_row("seed", 0),
        "output": "人工车厢",
        "meta": {
            "source": "human-authored",
            "visibility": "player",
            "group": "seed:human:12",
            "pack": "mist-harbor",
            "scene_id": "loc.carriage",
            "family_group": "mist-harbor:scene:carriage",
        },
    }
    split_dataset([template, seed, _row("filler", 0)], tmp_path, seed=8503)

    split_by_output = {
        row.get("output", row.get("reference_output")): name
        for name, path in {
            "train": tmp_path / "train.sft.jsonl",
            "validation": tmp_path / "validation.sft.jsonl",
            "test": tmp_path / "test.prompts.jsonl",
        }.items()
        for row in _rows(path)
    }

    assert split_by_output["模板车厢"] == split_by_output["人工车厢"]
