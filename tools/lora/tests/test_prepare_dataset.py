from pathlib import Path
import json
import sys

import pytest


LORA_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(LORA_ROOT))

from prepare_dataset import build_family_groups, load_candidate_rows, split_dataset


FIXTURE_PACKS = Path(__file__).resolve().parents[3] / "electron" / "content" / "packs"


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


def test_prepare_is_the_authoritative_dataset_registry_writer(tmp_path: Path):
    split_dataset(FIXTURE_ROWS, tmp_path, seed=8503)

    registry = json.loads((tmp_path / "dataset_info.json").read_text(encoding="utf-8"))
    expected_columns = {"prompt": "instruction", "query": "input", "response": "output"}
    assert registry["trpg_dm_train"] == {
        "file_name": "train.sft.jsonl",
        "columns": expected_columns,
    }
    assert registry["trpg_dm_validation"] == {
        "file_name": "validation.sft.jsonl",
        "columns": expected_columns,
    }
    assert registry["sources"]["synthetic-template"]["count"] == 10
    assert registry["sources"]["human-authored"]["count"] == 1


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


def test_content_fact_relationships_define_one_family_for_related_entities():
    families = build_family_groups(FIXTURE_PACKS)

    assert families["photo-studio:room:loc.shop"] == families["photo-studio:fact:fact.name_torn"]
    assert families["mist-harbor:investigation:investigation.old-line-reporter"] == families[
        "mist-harbor:fact:fact.old_line"
    ]
    assert families["mist-harbor:fact:fact.old_line"] == families["mist-harbor:room:loc.cab"]
    assert families["mist-harbor:npc:npc.reporter"] == families["mist-harbor:fact:fact.reporter_note"]


def test_content_relationships_cover_every_current_template_entity():
    families = build_family_groups(FIXTURE_PACKS)
    candidate_rows = [json.loads(line) for line in (LORA_ROOT / "data" / "train.jsonl").read_text(encoding="utf-8").splitlines()]
    template_entities = {
        f"{row['meta']['pack']}:{row['meta']['kind']}:{row['meta']['entity_id']}"
        for row in candidate_rows
        if row["meta"]["source"] == "synthetic-template"
    }

    assert len(template_entities) == 42
    assert template_entities <= set(families)


def test_current_dataset_uses_one_family_namespace_for_every_split(tmp_path: Path):
    rows = load_candidate_rows(LORA_ROOT / "data" / "train.jsonl", LORA_ROOT / "data" / "seeds.jsonl")
    manifest = split_dataset(rows, tmp_path, seed=8503)
    family_by_output = {row["output"]: row["meta"]["family_group"] for row in rows}
    split_outputs = {
        "train": [row["output"] for row in _rows(tmp_path / "train.sft.jsonl")],
        "validation": [row["output"] for row in _rows(tmp_path / "validation.sft.jsonl")],
        "test": [row["reference_output"] for row in _rows(tmp_path / "test.prompts.jsonl")],
    }
    expected_groups = {
        name: {family_by_output[output] for output in outputs} for name, outputs in split_outputs.items()
    }

    assert {name: set(details["groups"]) for name, details in manifest["splits"].items()} == expected_groups
    assert expected_groups["train"].isdisjoint(expected_groups["validation"])
    assert expected_groups["train"].isdisjoint(expected_groups["test"])
    assert expected_groups["validation"].isdisjoint(expected_groups["test"])

    shop_seed = next(row for row in rows if row["input"] == "我仔细看玻璃柜里发黄的合影。")
    shop_template = next(row for row in rows if row["meta"]["group"] == "photo-studio:room:loc.shop")
    assert shop_seed["meta"]["family_group"] == shop_template["meta"]["family_group"]


def test_synthetic_test_prompts_do_not_repeat_train_prompts_across_families(tmp_path: Path):
    rows = load_candidate_rows(LORA_ROOT / "data" / "train.jsonl", LORA_ROOT / "data" / "seeds.jsonl")
    split_dataset(rows, tmp_path, seed=8503)

    source_by_output = {row["output"]: row["meta"]["source"] for row in rows}
    train_prompts = {
        f"{row['instruction']}\n\n{row['input']}"
        for row in _rows(tmp_path / "train.sft.jsonl")
    }
    synthetic_test_prompts = {
        row["prompt"]
        for row in _rows(tmp_path / "test.prompts.jsonl")
        if source_by_output[row["reference_output"]] == "synthetic-template"
    }
    synthetic_inputs_by_family = {}
    for row in rows:
        if row["meta"]["source"] != "synthetic-template":
            continue
        synthetic_inputs_by_family.setdefault(row["input"], set()).add(row["meta"]["family_group"])

    assert synthetic_test_prompts
    assert synthetic_test_prompts.isdisjoint(train_prompts)
    assert all(len(families) == 1 for families in synthetic_inputs_by_family.values())
