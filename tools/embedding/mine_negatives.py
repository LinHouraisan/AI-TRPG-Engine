"""Mine hard negatives from a base model without crossing dataset splits.

The input ``documents.jsonl`` is a training-only corpus that may contain
keeper-only or secret authored fields.  Do not expose it as the player-facing
runtime index.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

if __package__:
    from tools.embedding.evaluate import (
        load_jsonl_snapshot,
        load_manifest_provenance,
        load_model,
        publish_files,
        rank_rows,
        validate_manifest_hash,
    )
else:
    from evaluate import (
        load_jsonl_snapshot,
        load_manifest_provenance,
        load_model,
        publish_files,
        rank_rows,
        validate_manifest_hash,
    )


def mine_hard_negatives(
    rows: list[dict],
    ranked_ids: dict[str, list[str]],
    valid_document_ids: set[str] | None = None,
) -> list[dict]:
    mined: list[dict] = []
    for row in rows:
        query = str(row.get("query", "")).strip()
        positive_id = str(row.get("positive_id", "")).strip()
        ranking = ranked_ids.get(query, [])
        if valid_document_ids is not None:
            unknown_ids = set(ranking) - valid_document_ids
            if unknown_ids:
                raise ValueError(f"ranking contains unknown document IDs: {sorted(unknown_ids)}")
            if positive_id not in valid_document_ids:
                raise ValueError(f"positive_id is unknown: {positive_id or '<empty>'}")
        negative_id = next((document_id for document_id in ranking if document_id != positive_id), "")
        mined.append({**row, "negative_id": negative_id})
    return mined


def select_split_documents(rows: Sequence[dict], documents: Sequence[dict]) -> tuple[list[dict], set[str]]:
    if not rows:
        raise ValueError("input split is empty")
    documents_by_id = {str(document.get("id", "")): document for document in documents}
    if len(documents_by_id) != len(documents) or "" in documents_by_id:
        raise ValueError("document IDs must be non-empty and unique")

    # The split's positive IDs define its candidate corpus. Using the complete
    # corpus would reintroduce entity groups deliberately held out elsewhere.
    split_document_ids = {str(row.get("positive_id", "")) for row in rows}
    unknown_positive_ids = split_document_ids - set(documents_by_id)
    if "" in split_document_ids or unknown_positive_ids:
        invalid_ids = unknown_positive_ids | ({"<empty>"} if "" in split_document_ids else set())
        raise ValueError(f"split contains unknown positive IDs: {sorted(invalid_ids)}")
    return [documents_by_id[document_id] for document_id in sorted(split_document_ids)], split_document_ids


def write_mining_outputs(rows: Sequence[dict], manifest: dict, output_path: Path) -> None:
    rows_payload = "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows)
    manifest_path = output_path.with_suffix(output_path.suffix + ".manifest.json")
    manifest_payload = json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    publish_files({output_path: rows_payload.encode("utf-8"), manifest_path: manifest_payload.encode("utf-8")})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="BAAI/bge-small-zh-v1.5")
    parser.add_argument("--data", type=Path, required=True, help="One train/validation/test split JSONL")
    parser.add_argument("--docs", type=Path, required=True, help="Training-only documents.jsonl")
    parser.add_argument("--out", type=Path, required=True, help="A new JSONL file; the input split is never overwritten")
    parser.add_argument("--manifest", type=Path, help="Defaults to manifest.json beside --data")
    parser.add_argument("--seed", type=int, help="Expected manifest seed; mismatch is an error")
    args = parser.parse_args()
    manifest_path = args.manifest or args.data.parent / "manifest.json"
    output_paths = {args.out.resolve(), args.out.with_suffix(args.out.suffix + ".manifest.json").resolve()}
    input_paths = {args.data.resolve(), args.docs.resolve(), manifest_path.resolve()}
    if output_paths & input_paths:
        parser.error("--out and its manifest must differ from all input files")

    data = load_jsonl_snapshot(args.data)
    docs = load_jsonl_snapshot(args.docs)
    provenance = load_manifest_provenance(manifest_path, expected_seed=args.seed)
    validate_manifest_hash(provenance, args.data, data.sha256)
    validate_manifest_hash(provenance, args.docs, docs.sha256, manifest_name="documents.jsonl")
    documents_by_id = {document["id"]: document for document in docs.rows}
    split_documents, split_document_ids = select_split_documents(data.rows, docs.rows)

    traces = rank_rows(load_model(args.model), data.rows, split_documents)
    ranked_ids = {trace["query"]: trace["ranked_ids"] for trace in traces}
    mined = mine_hard_negatives(data.rows, ranked_ids, valid_document_ids=split_document_ids)
    for row in mined:
        row["negative"] = documents_by_id[row["negative_id"]]["text"] if row["negative_id"] else ""
        if row["negative_id"] == row["positive_id"]:
            raise AssertionError("a hard negative must differ from the positive document")
    manifest = {
        "schema_version": 1,
        "model": args.model,
        "data_sha256": data.sha256,
        "documents_sha256": docs.sha256,
        "manifest_sha256": provenance.sha256,
        "seed": provenance.seed,
        "sample_count": len(data.rows),
        "candidate_document_count": len(split_documents),
        "rankings": traces,
    }
    write_mining_outputs(mined, manifest, args.out)
    print(json.dumps({"sample_count": len(data.rows), "output": str(args.out)}, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
