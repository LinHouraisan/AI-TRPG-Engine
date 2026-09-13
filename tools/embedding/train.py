"""Train and export the TRPG domain embedding model.

This is Sentence Transformers contrastive fine-tuning, not LoRA.  The default
loss uses only (query, positive) pairs and treats other positives in the batch
as in-batch negatives; JSONL ``negative`` fields are deliberately ignored.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

try:
    from tools.embedding.evaluate import (
        load_jsonl_snapshot,
        load_manifest_provenance,
        publish_files,
        validate_manifest_hash,
    )
except ModuleNotFoundError:  # Direct ``python tools/embedding/train.py`` use.
    from evaluate import (  # type: ignore[no-redef]
        load_jsonl_snapshot,
        load_manifest_provenance,
        publish_files,
        validate_manifest_hash,
    )


@dataclass(frozen=True)
class TrainingConfig:
    model_name: str = "BAAI/bge-small-zh-v1.5"
    output_dir: Path = Path("tools/embedding/saves/bge-small-zh-trpg")
    seed: int = 8503
    epochs: int = 3
    max_seq_length: int = 512
    batch_size: int = 16
    learning_rate: float = 2e-5
    warmup_ratio: float = 0.1
    max_steps: int = -1
    device: str = "cuda"

    def __post_init__(self) -> None:
        if self.epochs <= 0:
            raise ValueError("epochs must be positive")
        if not 1 <= self.max_seq_length <= 512:
            raise ValueError("max_seq_length must be between 1 and 512")
        if self.batch_size <= 0:
            raise ValueError("batch_size must be positive")
        if self.learning_rate <= 0:
            raise ValueError("learning_rate must be positive")
        if not 0 <= self.warmup_ratio < 1:
            raise ValueError("warmup_ratio must be in [0, 1)")
        if self.max_steps == 0 or self.max_steps < -1:
            raise ValueError("max_steps must be -1 or positive")
        if not self.model_name.strip():
            raise ValueError("model_name must not be empty")


@dataclass(frozen=True)
class TrainingData:
    train_pairs: list[tuple[str, str]]
    validation_pairs: list[tuple[str, str]]
    seed: int
    train_sha256: str
    validation_sha256: str
    manifest_sha256: str


def _pairs(rows: list[dict], split: str) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for index, row in enumerate(rows, start=1):
        query = row.get("query")
        positive = row.get("positive")
        if not isinstance(query, str) or not query.strip() or not isinstance(positive, str) or not positive.strip():
            raise ValueError(f"{split} row {index} must have non-empty query and positive strings")
        pairs.append((query.strip(), positive.strip()))
    if not pairs:
        raise ValueError(f"{split} split is empty")
    return pairs


def load_training_data(data_dir: Path, expected_seed: int = 8503) -> TrainingData:
    """Read train/validation once and bind both byte snapshots to Task 1's manifest."""

    train_path = data_dir / "train.jsonl"
    validation_path = data_dir / "validation.jsonl"
    manifest_path = data_dir / "manifest.json"
    train = load_jsonl_snapshot(train_path)
    validation = load_jsonl_snapshot(validation_path)
    provenance = load_manifest_provenance(manifest_path, expected_seed=expected_seed)
    validate_manifest_hash(provenance, train_path, train.sha256, manifest_name="train.jsonl")
    validate_manifest_hash(
        provenance,
        validation_path,
        validation.sha256,
        manifest_name="validation.jsonl",
    )
    return TrainingData(
        train_pairs=_pairs(train.rows, "train"),
        validation_pairs=_pairs(validation.rows, "validation"),
        seed=provenance.seed,
        train_sha256=train.sha256,
        validation_sha256=validation.sha256,
        manifest_sha256=provenance.sha256,
    )


def import_training_stack() -> tuple[Any, Any, Any, Any, Any, Any, Any]:
    """Import optional training dependencies only for an actual training run."""

    import accelerate  # noqa: F401 - required by the Trainer runtime
    import torch
    from datasets import Dataset
    from sentence_transformers import (
        SentenceTransformer,
        SentenceTransformerTrainer,
        SentenceTransformerTrainingArguments,
        losses,
    )
    from sentence_transformers.training_args import BatchSamplers

    return (
        torch,
        Dataset,
        SentenceTransformer,
        SentenceTransformerTrainer,
        SentenceTransformerTrainingArguments,
        losses,
        BatchSamplers,
    )


def build_training_metadata(config: TrainingConfig, data: TrainingData) -> dict:
    parameters = asdict(config)
    parameters["output_dir"] = str(config.output_dir)
    return {
        "schema_version": 1,
        "method": "sentence-transformers contrastive fine-tuning",
        "base_model": config.model_name,
        "loss": "MultipleNegativesRankingLoss",
        "negative_source": "in-batch only",
        "explicit_negative_fields_used": False,
        "actual_parameters": parameters,
        "data": {
            "seed": data.seed,
            "train_samples": len(data.train_pairs),
            "validation_samples": len(data.validation_pairs),
            "train_sha256": data.train_sha256,
            "validation_sha256": data.validation_sha256,
            "manifest_sha256": data.manifest_sha256,
        },
    }


def _json_bytes(payload: dict) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def prepare_output_for_run(output_dir: Path) -> Path:
    """Invalidate any stale success marker before a non-check training run."""

    resolved = output_dir.expanduser().resolve()
    resolved.mkdir(parents=True, exist_ok=True)
    (resolved / "training-complete.json").unlink(missing_ok=True)
    return resolved


def train(config: TrainingConfig, data: TrainingData) -> None:
    output_dir = prepare_output_for_run(config.output_dir)
    (
        torch,
        Dataset,
        SentenceTransformer,
        SentenceTransformerTrainer,
        SentenceTransformerTrainingArguments,
        losses,
        BatchSamplers,
    ) = import_training_stack()
    if config.device.startswith("cuda") and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested but torch.cuda.is_available() is false")

    random.seed(config.seed)
    torch.manual_seed(config.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(config.seed)

    completion_path = output_dir / "training-complete.json"
    metadata = build_training_metadata(config, data)
    publish_files({output_dir / "training-config.json": _json_bytes(metadata)})

    model = SentenceTransformer(config.model_name, device=config.device)
    model.max_seq_length = config.max_seq_length
    train_dataset = Dataset.from_dict(
        {
            "anchor": [query for query, _ in data.train_pairs],
            "positive": [positive for _, positive in data.train_pairs],
        }
    )
    validation_dataset = Dataset.from_dict(
        {
            "anchor": [query for query, _ in data.validation_pairs],
            "positive": [positive for _, positive in data.validation_pairs],
        }
    )
    use_fp16 = config.device.startswith("cuda")
    training_args = SentenceTransformerTrainingArguments(
        output_dir=str(output_dir / "checkpoints"),
        num_train_epochs=config.epochs,
        max_steps=config.max_steps,
        per_device_train_batch_size=config.batch_size,
        per_device_eval_batch_size=config.batch_size,
        learning_rate=config.learning_rate,
        warmup_ratio=config.warmup_ratio,
        fp16=use_fp16,
        bf16=False,
        batch_sampler=BatchSamplers.NO_DUPLICATES,
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=1,
        logging_steps=10,
        seed=config.seed,
        data_seed=config.seed,
        run_name="bge-small-zh-trpg",
    )
    loss = losses.MultipleNegativesRankingLoss(model)
    trainer = SentenceTransformerTrainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=validation_dataset,
        loss=loss,
    )
    trainer.train()
    model.save_pretrained(str(output_dir))

    # A saved directory is not considered complete until the public loader can
    # reconstruct it.  Keep this object alive only long enough to prove reload.
    reloaded = SentenceTransformer(str(output_dir), device=config.device)
    if not getattr(reloaded, "max_seq_length", None):
        raise RuntimeError("exported model reloaded without a max_seq_length")

    completion = {
        "status": "complete",
        "model_path": str(output_dir),
        "training_config_sha256": hashlib.sha256(_json_bytes(metadata)).hexdigest(),
        "manifest_sha256": data.manifest_sha256,
    }
    publish_files({completion_path: _json_bytes(completion)})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("tools/embedding/data"))
    parser.add_argument("--output", type=Path, default=TrainingConfig.output_dir)
    parser.add_argument("--model", default=TrainingConfig.model_name)
    parser.add_argument("--seed", type=int, default=TrainingConfig.seed)
    parser.add_argument("--epochs", type=int, default=TrainingConfig.epochs)
    parser.add_argument("--max-seq-length", type=int, default=TrainingConfig.max_seq_length)
    parser.add_argument("--batch-size", type=int, default=TrainingConfig.batch_size)
    parser.add_argument("--learning-rate", type=float, default=TrainingConfig.learning_rate)
    parser.add_argument("--warmup-ratio", type=float, default=TrainingConfig.warmup_ratio)
    parser.add_argument("--max-steps", type=int, default=TrainingConfig.max_steps)
    parser.add_argument("--device", default=TrainingConfig.device)
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Validate config and Task 1 manifest/data without loading a model",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = TrainingConfig(
        model_name=args.model,
        output_dir=args.output.expanduser().resolve(),
        seed=args.seed,
        epochs=args.epochs,
        max_seq_length=args.max_seq_length,
        batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        warmup_ratio=args.warmup_ratio,
        max_steps=args.max_steps,
        device=args.device,
    )
    if not args.check_only:
        prepare_output_for_run(config.output_dir)
    data = load_training_data(args.data, expected_seed=config.seed)
    if args.check_only:
        print(json.dumps(build_training_metadata(config, data), ensure_ascii=False, sort_keys=True))
        return
    train(config, data)
    print(json.dumps({"status": "complete", "output": str(config.output_dir.resolve())}, ensure_ascii=False))


if __name__ == "__main__":
    main()
