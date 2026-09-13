import hashlib
import json
from pathlib import Path
import subprocess
import sys

import pytest

import tools.embedding.evaluate as evaluate_module
from tools.embedding.evaluate import (
    RetrievalMetrics,
    load_jsonl_snapshot,
    load_manifest_provenance,
    score_rankings,
    validate_manifest_hash,
)
from tools.embedding.mine_negatives import (
    mine_hard_negatives,
    select_split_documents,
    write_mining_outputs,
)


def test_first_wrong_high_rank_is_selected():
    rows = [{"query": "钟几点", "positive_id": "fact.clock"}]

    mined = mine_hard_negatives(rows, {"钟几点": ["fact.other", "fact.clock"]})

    assert mined[0]["negative_id"] == "fact.other"


def test_mining_skips_duplicate_positive_and_does_not_mutate_input():
    row = {"query": "钟几点", "positive_id": "fact.clock", "negative_id": "old"}

    mined = mine_hard_negatives(
        [row],
        {"钟几点": ["fact.clock", "fact.clock", "fact.other"]},
    )

    assert mined[0]["negative_id"] == "fact.other"
    assert row["negative_id"] == "old"


def test_mining_rejects_ranked_ids_outside_allowed_documents():
    rows = [{"query": "钟几点", "positive_id": "fact.clock"}]

    with pytest.raises(ValueError, match="unknown"):
        mine_hard_negatives(
            rows,
            {"钟几点": ["fact.from-another-split", "fact.clock"]},
            valid_document_ids={"fact.clock", "fact.other"},
        )


def test_mining_never_uses_positive_as_negative_when_no_wrong_result_exists():
    rows = [{"query": "钟几点", "positive_id": "fact.clock"}]

    mined = mine_hard_negatives(rows, {"钟几点": ["fact.clock"]})

    assert mined[0]["negative_id"] == ""


def test_mining_candidates_only_include_documents_owned_by_the_split():
    rows = [
        {"query": "钟几点", "positive_id": "fact.clock"},
        {"query": "钥匙做什么", "positive_id": "item.key"},
    ]
    documents = [
        {"id": "fact.clock", "text": "十一点"},
        {"id": "item.key", "text": "开门"},
        {"id": "secret.from-test-split", "text": "不应成为训练负样本"},
    ]

    selected, selected_ids = select_split_documents(rows, documents)

    assert selected_ids == {"fact.clock", "item.key"}
    assert [document["id"] for document in selected] == ["fact.clock", "item.key"]


def test_metrics_for_rank_two_hit():
    metrics = score_rankings([["wrong", "gold"]], ["gold"], k=3)

    assert metrics == RetrievalMetrics(recall_at_3=1.0, mrr=0.5, ndcg_at_3=pytest.approx(1 / 1.584962500721156))


def test_metrics_deduplicate_ranked_ids_before_scoring():
    metrics = score_rankings([["wrong", "wrong", "gold"]], ["gold"], k=3)

    assert metrics.recall_at_3 == 1.0
    assert metrics.mrr == 0.5
    assert metrics.ndcg_at_3 == pytest.approx(1 / 1.584962500721156)


def test_metrics_count_empty_ranking_as_a_miss():
    metrics = score_rankings([[], ["gold"]], ["gold", "gold"], k=3)

    assert metrics.recall_at_3 == 0.5
    assert metrics.mrr == 0.5
    assert metrics.ndcg_at_3 == 0.5


def test_metrics_reject_empty_or_misaligned_evaluation_sets():
    with pytest.raises(ValueError, match="empty"):
        score_rankings([], [], k=3)
    with pytest.raises(ValueError, match="same number"):
        score_rankings([["gold"]], [], k=3)


def test_evaluator_module_does_not_import_sentence_transformers_eagerly():
    source = (Path(__file__).parents[1] / "evaluate.py").read_text(encoding="utf-8")

    prefix = source.split("def load_model", 1)[0]
    assert "sentence_transformers" not in prefix


def test_trace_report_keeps_reproducibility_fields(tmp_path: Path):
    from tools.embedding.evaluate import build_report, write_report

    rankings = [
        {
            "query": "钟几点",
            "gold_id": "fact.clock",
            "ranked_ids": ["fact.other", "fact.clock"],
            "latency_ms": 2.5,
        }
    ]
    report = build_report(
        rankings,
        model_name="BAAI/bge-small-zh-v1.5",
        data_hash="a" * 64,
        docs_hash="b" * 64,
        manifest_hash="c" * 64,
        seed=8503,
        k=3,
    )
    output = tmp_path / "report"

    write_report(report, output)

    saved = json.loads(output.with_suffix(".json").read_text(encoding="utf-8"))
    assert saved["model"] == "BAAI/bge-small-zh-v1.5"
    assert saved["data_sha256"] == "a" * 64
    assert saved["documents_sha256"] == "b" * 64
    assert saved["manifest_sha256"] == "c" * 64
    assert saved["seed"] == 8503
    assert saved["sample_count"] == 1
    assert saved["rankings"] == rankings
    assert output.with_suffix(".md").exists()


def test_negative_mining_cli_can_be_executed_as_a_script():
    script = Path(__file__).parents[1] / "mine_negatives.py"

    result = subprocess.run(
        [sys.executable, "-B", str(script), "--help"],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr


def test_jsonl_snapshot_reads_once_and_hashes_the_parsed_bytes(tmp_path: Path, monkeypatch):
    path = tmp_path / "test.jsonl"
    raw = b'{"query":"clock","positive_id":"fact.clock"}\n'
    path.write_bytes(raw)
    original_read_bytes = Path.read_bytes
    calls = 0

    def counted_read_bytes(self):
        nonlocal calls
        calls += 1
        return original_read_bytes(self)

    monkeypatch.setattr(Path, "read_bytes", counted_read_bytes)
    snapshot = load_jsonl_snapshot(path)

    assert calls == 1
    assert snapshot.rows[0]["positive_id"] == "fact.clock"
    assert snapshot.sha256 == hashlib.sha256(raw).hexdigest()


def test_manifest_seed_is_actual_provenance_not_a_free_label(tmp_path: Path):
    path = tmp_path / "manifest.json"
    raw = b'{"seed":8503,"sha256":{}}\n'
    path.write_bytes(raw)

    provenance = load_manifest_provenance(path, expected_seed=8503)

    assert provenance.seed == 8503
    assert provenance.sha256 == hashlib.sha256(raw).hexdigest()
    with pytest.raises(ValueError, match="seed"):
        load_manifest_provenance(path, expected_seed=7)


def test_manifest_declared_hash_must_match_loaded_snapshot(tmp_path: Path):
    path = tmp_path / "manifest.json"
    path.write_text('{"seed":8503,"sha256":{"test.jsonl":"declared"}}', encoding="utf-8")
    provenance = load_manifest_provenance(path)

    with pytest.raises(ValueError, match="SHA-256"):
        validate_manifest_hash(provenance, tmp_path / "test.jsonl", "actual")


def test_report_pair_rolls_back_existing_targets_when_second_replace_fails(tmp_path: Path, monkeypatch):
    from tools.embedding.evaluate import build_report, write_report

    output = tmp_path / "report"
    json_path = output.with_suffix(".json")
    markdown_path = output.with_suffix(".md")
    json_path.write_text("old json", encoding="utf-8")
    markdown_path.write_text("old markdown", encoding="utf-8")
    report = build_report(
        [{"query": "钟几点", "gold_id": "clock", "ranked_ids": ["clock"], "latency_ms": 1.0}],
        model_name="model",
        data_hash="a" * 64,
        docs_hash="b" * 64,
        manifest_hash="c" * 64,
        seed=8503,
    )
    original_replace = evaluate_module.os.replace
    publish_calls = 0

    def fail_second_replace(source, target):
        nonlocal publish_calls
        if Path(source).suffix == ".tmp":
            publish_calls += 1
        if publish_calls == 2 and Path(source).suffix == ".tmp":
            raise OSError("injected second replace failure")
        return original_replace(source, target)

    monkeypatch.setattr(evaluate_module.os, "replace", fail_second_replace)

    with pytest.raises(OSError, match="second replace"):
        write_report(report, output)

    assert json_path.read_text(encoding="utf-8") == "old json"
    assert markdown_path.read_text(encoding="utf-8") == "old markdown"
    assert {path.name for path in tmp_path.iterdir()} == {"report.json", "report.md"}


def test_mining_pair_keeps_existing_targets_when_second_temp_write_fails(tmp_path: Path, monkeypatch):
    output = tmp_path / "train.hard.jsonl"
    manifest_path = output.with_suffix(output.suffix + ".manifest.json")
    output.write_text("old rows", encoding="utf-8")
    manifest_path.write_text("old manifest", encoding="utf-8")
    original_write = evaluate_module._write_temp_file
    calls = 0

    def fail_second_write(target, payload):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("injected second write failure")
        return original_write(target, payload)

    monkeypatch.setattr(evaluate_module, "_write_temp_file", fail_second_write)

    with pytest.raises(OSError, match="second write"):
        write_mining_outputs(
            [{"query": "钟几点", "positive_id": "clock", "negative_id": "other"}],
            {"seed": 8503},
            output,
        )

    assert output.read_text(encoding="utf-8") == "old rows"
    assert manifest_path.read_text(encoding="utf-8") == "old manifest"
    assert {path.name for path in tmp_path.iterdir()} == {"train.hard.jsonl", "train.hard.jsonl.manifest.json"}
