"""Evaluate TRPG retrieval with deterministic, judge-free IR metrics.

``documents.jsonl`` is a training-only artifact and may preserve authored keeper
or secret fields.  It must never be wired directly into the player-facing
runtime index, which has a separate visibility filter.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Sequence


@dataclass(frozen=True)
class RetrievalMetrics:
    recall_at_3: float
    mrr: float
    ndcg_at_3: float


def _unique(ids: Sequence[str]) -> list[str]:
    return list(dict.fromkeys(ids))


def score_rankings(rankings: Sequence[Sequence[str]], gold_ids: Sequence[str], k: int = 3) -> RetrievalMetrics:
    if not rankings:
        raise ValueError("evaluation set is empty")
    if len(rankings) != len(gold_ids):
        raise ValueError("rankings and gold_ids must contain the same number of samples")
    if k <= 0:
        raise ValueError("k must be positive")

    recalls: list[float] = []
    reciprocal_ranks: list[float] = []
    discounted_gains: list[float] = []
    for ranked_ids, gold_id in zip(rankings, gold_ids, strict=True):
        if not gold_id:
            raise ValueError("gold document ID must not be empty")
        unique_ids = _unique(ranked_ids)
        try:
            rank = unique_ids.index(gold_id) + 1
        except ValueError:
            rank = 0
        recalls.append(float(0 < rank <= k))
        reciprocal_ranks.append(1.0 / rank if rank else 0.0)
        discounted_gains.append(1.0 / math.log2(rank + 1) if 0 < rank <= k else 0.0)

    count = len(rankings)
    return RetrievalMetrics(
        recall_at_3=sum(recalls) / count,
        mrr=sum(reciprocal_ranks) / count,
        ndcg_at_3=sum(discounted_gains) / count,
    )


def load_model(model_name: str) -> Any:
    """Load the optional model dependency only for an actual CLI/model run."""

    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(model_name)


def _vector_values(vector: Any) -> list[float]:
    return vector.tolist() if hasattr(vector, "tolist") else list(vector)


def _dot(left: Any, right: Any) -> float:
    return sum(a * b for a, b in zip(_vector_values(left), _vector_values(right), strict=True))


def rank_rows(model: Any, rows: Sequence[dict], documents: Sequence[dict]) -> list[dict]:
    if not documents:
        raise ValueError("document collection is empty")
    document_ids = [str(document.get("id", "")) for document in documents]
    if any(not document_id for document_id in document_ids) or len(set(document_ids)) != len(document_ids):
        raise ValueError("document IDs must be non-empty and unique")
    document_texts = [str(document.get("text", "")) for document in documents]
    document_vectors = model.encode(document_texts, normalize_embeddings=True, convert_to_numpy=True)
    known_ids = set(document_ids)

    traces: list[dict] = []
    for row in rows:
        query = str(row.get("query", "")).strip()
        gold_id = str(row.get("positive_id", "")).strip()
        if not query or gold_id not in known_ids:
            raise ValueError(f"query has an unknown gold document ID: {gold_id or '<empty>'}")
        started = time.perf_counter()
        query_vector = model.encode([query], normalize_embeddings=True, convert_to_numpy=True)[0]
        latency_ms = (time.perf_counter() - started) * 1000
        scores = [(_dot(query_vector, vector), document_id) for document_id, vector in zip(document_ids, document_vectors, strict=True)]
        scores.sort(key=lambda item: (-item[0], item[1]))
        traces.append(
            {
                "query": query,
                "gold_id": gold_id,
                "ranked_ids": [document_id for _, document_id in scores],
                "latency_ms": round(latency_ms, 6),
            }
        )
    return traces


def build_report(
    rankings: Sequence[dict],
    *,
    model_name: str,
    data_hash: str,
    docs_hash: str,
    seed: int,
    k: int = 3,
) -> dict:
    metrics = score_rankings(
        [trace["ranked_ids"] for trace in rankings],
        [trace["gold_id"] for trace in rankings],
        k=k,
    )
    return {
        "schema_version": 1,
        "model": model_name,
        "data_sha256": data_hash,
        "documents_sha256": docs_hash,
        "seed": seed,
        "sample_count": len(rankings),
        "k": k,
        "metrics": asdict(metrics),
        "average_query_latency_ms": sum(trace["latency_ms"] for trace in rankings) / len(rankings),
        "rankings": list(rankings),
    }


def write_report(report: dict, output_prefix: Path) -> None:
    output_prefix.parent.mkdir(parents=True, exist_ok=True)
    json_path = output_prefix.with_suffix(".json")
    markdown_path = output_prefix.with_suffix(".md")
    json_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    metrics = report["metrics"]
    markdown_path.write_text(
        "\n".join(
            [
                "# TRPG Embedding 检索评测",
                "",
                f"- 模型：`{report['model']}`",
                f"- 样本数：{report['sample_count']}",
                f"- Seed：{report['seed']}",
                f"- Recall@3：{metrics['recall_at_3']:.6f}",
                f"- MRR：{metrics['mrr']:.6f}",
                f"- nDCG@3：{metrics['ndcg_at_3']:.6f}",
                f"- 平均查询编码延迟：{report['average_query_latency_ms']:.3f} ms",
                f"- 数据 SHA-256：`{report['data_sha256']}`",
                f"- 文档 SHA-256：`{report['documents_sha256']}`",
                "",
                "本报告只记录纯 IR 指标，不使用裁判 LLM。延迟不可跨硬件直接比较。",
                "",
            ]
        ),
        encoding="utf-8",
        newline="\n",
    )


def _read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--docs", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True, help="Output prefix for JSON and Markdown reports")
    parser.add_argument("--seed", type=int, default=8503)
    args = parser.parse_args()

    rows = _read_jsonl(args.data)
    documents = _read_jsonl(args.docs)
    if not rows:
        raise ValueError("evaluation set is empty")
    traces = rank_rows(load_model(args.model), rows, documents)
    report = build_report(
        traces,
        model_name=args.model,
        data_hash=_sha256(args.data),
        docs_hash=_sha256(args.docs),
        seed=args.seed,
    )
    write_report(report, args.out)
    print(json.dumps({"sample_count": report["sample_count"], **report["metrics"]}, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
