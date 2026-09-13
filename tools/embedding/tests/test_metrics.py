import json
from pathlib import Path
import subprocess
import sys

import pytest

from tools.embedding.evaluate import RetrievalMetrics, score_rankings
from tools.embedding.mine_negatives import mine_hard_negatives, select_split_documents


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
        seed=8503,
        k=3,
    )
    output = tmp_path / "report"

    write_report(report, output)

    saved = json.loads(output.with_suffix(".json").read_text(encoding="utf-8"))
    assert saved["model"] == "BAAI/bge-small-zh-v1.5"
    assert saved["data_sha256"] == "a" * 64
    assert saved["documents_sha256"] == "b" * 64
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
