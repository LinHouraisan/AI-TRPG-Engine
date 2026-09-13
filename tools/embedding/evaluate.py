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
import os
import shutil
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence


@dataclass(frozen=True)
class RetrievalMetrics:
    recall_at_3: float
    mrr: float
    ndcg_at_3: float


@dataclass(frozen=True)
class JsonlSnapshot:
    rows: list[dict]
    sha256: str


@dataclass(frozen=True)
class ManifestProvenance:
    seed: int
    sha256: str
    payload: dict


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
    manifest_hash: str,
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
        "manifest_sha256": manifest_hash,
        "seed": seed,
        "sample_count": len(rankings),
        "k": k,
        "metrics": asdict(metrics),
        "average_query_latency_ms": sum(trace["latency_ms"] for trace in rankings) / len(rankings),
        "rankings": list(rankings),
    }


def _write_temp_file(target: Path, payload: bytes) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=target.parent)
    temp_path = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
    except BaseException:
        temp_path.unlink(missing_ok=True)
        raise
    return temp_path


def _backup_path(target: Path) -> Path:
    descriptor, name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".bak", dir=target.parent)
    os.close(descriptor)
    backup = Path(name)
    backup.unlink()
    return backup


def publish_files(payloads: Mapping[Path, bytes]) -> None:
    """Publish a group of files together, restoring prior targets on failure."""

    temp_paths: dict[Path, Path] = {}
    backups: dict[Path, Path] = {}
    published: list[Path] = []
    try:
        for target, payload in payloads.items():
            temp_paths[target] = _write_temp_file(target, payload)
        for target in payloads:
            if target.exists():
                backup = _backup_path(target)
                os.replace(target, backup)
                backups[target] = backup
        for target in payloads:
            os.replace(temp_paths[target], target)
            published.append(target)
    except BaseException:
        for target in reversed(published):
            target.unlink(missing_ok=True)
        for target, backup in reversed(list(backups.items())):
            try:
                os.replace(backup, target)
            except OSError:
                shutil.copyfile(backup, target)
                backup.unlink(missing_ok=True)
        raise
    finally:
        for temp_path in temp_paths.values():
            temp_path.unlink(missing_ok=True)
        for backup in backups.values():
            backup.unlink(missing_ok=True)


def write_report(report: dict, output_prefix: Path) -> None:
    json_path = output_prefix.with_suffix(".json")
    markdown_path = output_prefix.with_suffix(".md")
    metrics = report["metrics"]
    markdown = "\n".join(
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
            f"- 数据清单 SHA-256：`{report['manifest_sha256']}`",
            "",
            "本报告只记录纯 IR 指标，不使用裁判 LLM。延迟不可跨硬件直接比较。",
            "",
        ]
    )
    publish_files(
        {
            json_path: (json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8"),
            markdown_path: markdown.encode("utf-8"),
        }
    )


def load_jsonl_snapshot(path: Path) -> JsonlSnapshot:
    raw = path.read_bytes()
    text = raw.decode("utf-8")
    rows = [json.loads(line) for line in text.splitlines() if line.strip()]
    if not all(isinstance(row, dict) for row in rows):
        raise ValueError(f"JSONL rows must be objects: {path}")
    return JsonlSnapshot(rows=rows, sha256=hashlib.sha256(raw).hexdigest())


def load_manifest_provenance(path: Path, expected_seed: int | None = None) -> ManifestProvenance:
    raw = path.read_bytes()
    payload = json.loads(raw.decode("utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("seed"), int):
        raise ValueError(f"manifest has no integer seed: {path}")
    seed = payload["seed"]
    if expected_seed is not None and seed != expected_seed:
        raise ValueError(f"manifest seed {seed} does not match expected seed {expected_seed}")
    return ManifestProvenance(seed=seed, sha256=hashlib.sha256(raw).hexdigest(), payload=payload)


def validate_manifest_hash(provenance: ManifestProvenance, path: Path, actual_hash: str) -> None:
    declared_hash = provenance.payload.get("sha256", {}).get(path.name)
    if declared_hash is not None and declared_hash != actual_hash:
        raise ValueError(f"{path.name} does not match its manifest SHA-256")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--docs", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True, help="Output prefix for JSON and Markdown reports")
    parser.add_argument("--manifest", type=Path, help="Defaults to manifest.json beside --data")
    parser.add_argument("--seed", type=int, help="Expected manifest seed; mismatch is an error")
    args = parser.parse_args()

    manifest_path = args.manifest or args.data.parent / "manifest.json"
    output_paths = {args.out.with_suffix(".json").resolve(), args.out.with_suffix(".md").resolve()}
    input_paths = {args.data.resolve(), args.docs.resolve(), manifest_path.resolve()}
    if output_paths & input_paths:
        parser.error("report outputs must differ from --data, --docs, and --manifest")
    data = load_jsonl_snapshot(args.data)
    docs = load_jsonl_snapshot(args.docs)
    provenance = load_manifest_provenance(manifest_path, expected_seed=args.seed)
    validate_manifest_hash(provenance, args.data, data.sha256)
    validate_manifest_hash(provenance, args.docs, docs.sha256)
    if not data.rows:
        raise ValueError("evaluation set is empty")
    traces = rank_rows(load_model(args.model), data.rows, docs.rows)
    report = build_report(
        traces,
        model_name=args.model,
        data_hash=data.sha256,
        docs_hash=docs.sha256,
        manifest_hash=provenance.sha256,
        seed=provenance.seed,
    )
    write_report(report, args.out)
    print(json.dumps({"sample_count": report["sample_count"], **report["metrics"]}, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
