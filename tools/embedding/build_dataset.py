"""Build deterministic retrieval examples from authored TRPG content packs."""

import argparse
import hashlib
import json
import random
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Document:
    id: str
    pack: str
    kind: str
    title: str
    text: str


def split_name(group: str) -> str:
    bucket = int(hashlib.sha256(group.encode("utf-8")).hexdigest()[:8], 16) % 10
    return "test" if bucket == 0 else "validation" if bucket == 1 else "train"


def training_row(query: str, positive: Document, negative: Document | None) -> dict:
    return {
        "query": query.strip(),
        "positive": positive.text,
        "positive_id": positive.id,
        "negative": negative.text if negative else "",
        "negative_id": negative.id if negative else "",
        "group": f"{positive.pack}:{positive.id}",
        "source": "synthetic-template",
    }


def _load_json(path: Path) -> list[dict[str, Any]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"内容包 JSON 格式错误：{path}") from error
    if isinstance(data, dict):
        return [data]
    if not isinstance(data, list) or not all(isinstance(record, dict) for record in data):
        raise ValueError(f"内容包记录必须是对象或对象数组：{path}")
    return data


def _document_text(kind: str, title: str, record: dict[str, Any]) -> str:
    details = json.dumps(record, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return f"类型：{kind}\n名称：{title}\n字段：{details}"


def load_documents(packs_dir: Path, excluded_dir: Path | None = None) -> list[Document]:
    documents: list[Document] = []
    room_records: dict[tuple[str, str], dict[str, Any]] = {}
    excluded = excluded_dir.resolve() if excluded_dir else None
    for pack_dir in sorted(path for path in packs_dir.iterdir() if path.is_dir() and path.resolve() != excluded):
        if (pack_dir / "documents.jsonl").exists():
            continue
        for path in sorted(pack_dir.glob("*.json")):
            kind = path.stem.rstrip("s")
            for index, record in enumerate(_load_json(path), 1):
                title = str(record.get("title") or record.get("name") or record.get("id") or f"{kind} {index}").strip()
                record_id = str(record.get("id") or f"{kind}.{index}").strip()
                if kind == "room" and record.get("id"):
                    room_records[(pack_dir.name, record_id)] = record
                documents.append(
                    Document(
                        id=f"{pack_dir.name}:{kind}:{record_id}",
                        pack=pack_dir.name,
                        kind=kind,
                        title=title,
                        text=_document_text(kind, title, record),
                    )
                )
    room_titles = {
        (document.pack, document.id.rsplit(":", 1)[-1]): document.title
        for document in documents
        if document.kind == "room"
    }
    incoming_routes: dict[tuple[str, str], list[str]] = {}
    for (pack, source_id), record in room_records.items():
        for exit_info in record.get("exits", []):
            if not isinstance(exit_info, dict):
                continue
            destination_id = str(exit_info.get("to") or "")
            if (pack, destination_id) not in room_titles:
                continue
            source = room_titles[(pack, source_id)]
            via = str(exit_info.get("via") or "").strip()
            route = f"可从{source}{f'经由{via}' if via else ''}到达"
            incoming_routes.setdefault((pack, destination_id), []).append(route)
    return [
        replace(document, text=f"{document.text}\n到达方式：{'；'.join(incoming_routes[key])}")
        if (key := (document.pack, document.id.rsplit(":", 1)[-1])) in incoming_routes
        else document
        for document in documents
    ]


def _queries(document: Document) -> list[str]:
    templates = {
        "npc": [f"{document.title}知道什么？"],
        "room": [
            f"{document.title}有什么异常？",
            *([f"如何到达{document.title}？"] if "到达方式：" in document.text else []),
        ],
        "fact": [f"{document.title}意味着什么？"],
        "item": [f"{document.title}有什么作用？"],
    }
    return templates.get(document.kind, [f"{document.title}的关键信息是什么？"])


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as output:
        for row in rows:
            output.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_dataset(packs_dir: Path, output_dir: Path, seed: int = 8503) -> dict[str, int]:
    documents = load_documents(packs_dir, output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    _write_jsonl(output_dir / "documents.jsonl", [asdict(document) for document in documents])

    rng = random.Random(seed)
    rows_by_split = {"train": [], "validation": [], "test": []}
    documents_by_split = {split: [] for split in rows_by_split}
    for document in documents:
        documents_by_split[split_name(f"{document.pack}:{document.id}")].append(document)
    for positive in documents:
        split = split_name(f"{positive.pack}:{positive.id}")
        candidates = [document for document in documents_by_split[split] if document.id != positive.id]
        negative = rng.choice(candidates) if candidates else None
        for query in _queries(positive):
            row = training_row(query, positive, negative)
            rows_by_split[split].append(row)

    for split, rows in rows_by_split.items():
        _write_jsonl(output_dir / f"{split}.jsonl", rows)

    data_paths = [output_dir / "documents.jsonl", *(output_dir / f"{split}.jsonl" for split in rows_by_split)]
    manifest = {
        "seed": seed,
        "packs": sorted({document.pack for document in documents}),
        "documents": len(documents),
        "splits": {split: len(rows) for split, rows in rows_by_split.items()},
        "sha256": {path.name: _sha256(path) for path in data_paths},
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return {"documents": len(documents), **manifest["splits"]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packs", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=8503)
    args = parser.parse_args()
    print(json.dumps(build_dataset(args.packs, args.output, args.seed), ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
