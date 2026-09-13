from pathlib import Path
import sys


LORA_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(LORA_ROOT))

from synth_lora_data import synthesize_offline


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
    assert all(
        "凌晨三点" not in row["output"]
        for row in rows
        if row["meta"]["visibility"] == "player"
    )
