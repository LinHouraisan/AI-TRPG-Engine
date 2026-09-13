from pathlib import Path
import json
import sys


LORA_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(LORA_ROOT))

from prepare_dataset import load_candidate_rows, split_dataset


def _row(group: str, number: int) -> dict:
    return {
        "instruction": "主持人",
        "input": f"行动 {group} {number}",
        "output": f"回应 {group} {number}",
        "meta": {
            "source": "synthetic-template",
            "pack": "manor",
            "kind": "room",
            "entity_id": group,
            "group": f"manor:room:{group}",
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
        "meta": {"source": "human-authored", "group": "seed:human:1"},
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
