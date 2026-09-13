from pathlib import Path
import json
import sys

import pytest


LORA_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(LORA_ROOT))

from synth_lora_data import _write_training_data, synthesize_offline


FIXTURE_PACKS = Path(__file__).resolve().parents[3] / "electron" / "content" / "packs"


def test_offline_generation_is_deterministic_and_complete():
    first = synthesize_offline(FIXTURE_PACKS, total=40, seed=8503)
    second = synthesize_offline(FIXTURE_PACKS, total=40, seed=8503)

    assert first == second
    assert len(first) == 40
    assert all(row["output"].endswith("你要怎么做？") for row in first)
    assert all(row["meta"]["source"] == "synthetic-template" for row in first)


def test_offline_generation_enforces_player_safe_unique_outputs():
    rows = synthesize_offline(FIXTURE_PACKS, total=80, seed=8503)
    outputs = [row["output"] for row in rows]

    assert all(row["instruction"] for row in rows)
    assert all(row["input"] for row in rows)
    assert all(60 <= len(output) <= 220 for output in outputs)
    assert len(outputs) == len(set(outputs))
    assert all("你掷出了" not in output for output in outputs)
    assert all("检定成功" not in output for output in outputs)
    assert all("检定失败" not in output for output in outputs)


def test_player_rows_exclude_every_secret_marker_and_have_stable_groups():
    rows = synthesize_offline(FIXTURE_PACKS, total=400, seed=8503)
    secrets = []
    for facts_path in FIXTURE_PACKS.glob("*/facts.json"):
        facts = json.loads(facts_path.read_text(encoding="utf-8"))
        secrets.extend(fact for fact in facts if fact.get("visibility") == "secret")
    markers = {
        marker
        for fact in secrets
        for marker in [fact["title"], *fact.get("guardPhrases", [])]
    }

    player_rows = [row for row in rows if row["meta"]["visibility"] == "player"]
    assert player_rows
    assert all("group" in row["meta"] for row in rows)
    assert all(
        all(marker not in f"{row['input']}\n{row['output']}" for marker in markers)
        for row in player_rows
    )
    assert all(
        row["meta"]["group"]
        == f"{row['meta']['pack']}:{row['meta']['kind']}:{row['meta']['entity_id']}"
        for row in rows
    )


def test_unrelated_scenes_do_not_claim_a_public_fact_is_established():
    rows = synthesize_offline(FIXTURE_PACKS, total=400, seed=8503)
    public_titles = {
        fact["title"]
        for facts_path in FIXTURE_PACKS.glob("*/facts.json")
        for fact in json.loads(facts_path.read_text(encoding="utf-8"))
        if fact.get("visibility") == "public"
    }
    unrelated_rows = [row for row in rows if row["meta"]["kind"] in {"room", "investigation"}]

    assert unrelated_rows
    assert all(
        all(title not in row["output"] for title in public_titles)
        for row in unrelated_rows
    )


def test_manifest_keeps_api_rows_out_of_template_source_count(tmp_path):
    rows = [
        {
            "instruction": "主持人",
            "input": "我查看门厅。",
            "output": "门厅没有新的动静，但水痕仍向楼梯延伸。你要怎么做？",
            "meta": {"source": "api-model", "visibility": "player", "group": "api:seed:1"},
        },
        {
            "instruction": "主持人",
            "input": "我检查挂钟。",
            "output": "挂钟停在九点，钟摆却没有停下。你要怎么做？",
            "meta": {"source": "human-authored", "visibility": "player", "group": "seed:human:1"},
        },
    ]

    _write_training_data(tmp_path, rows)

    manifest = json.loads((tmp_path / "dataset_info.json").read_text(encoding="utf-8"))
    assert manifest["sources"]["api-model"]["count"] == 1
    assert manifest["sources"]["human-authored"]["count"] == 1
    assert "synthetic-template" not in manifest["sources"]


def test_malformed_present_json_names_its_path(tmp_path):
    pack = tmp_path / "broken-pack"
    pack.mkdir()
    facts_path = pack / "facts.json"
    facts_path.write_text("{not-json", encoding="utf-8")

    with pytest.raises(ValueError, match="facts.json"):
        synthesize_offline(tmp_path, total=1, seed=8503)
