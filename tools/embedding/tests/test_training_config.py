import hashlib
import json
from pathlib import Path
import subprocess
import sys

import pytest

import tools.embedding.train as train_module
from tools.embedding.train import TrainingConfig, load_training_data


def write_dataset(root: Path, *, seed: int = 8503) -> tuple[Path, Path]:
    root.mkdir()
    train_path = root / "train.jsonl"
    validation_path = root / "validation.jsonl"
    train_path.write_text(
        json.dumps(
            {
                "query": "钟停在几点？",
                "positive": "铜钟停在十一点四十七分。",
                "negative": "这个字段不应进入训练。",
                "negative_id": "fact.other",
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    validation_path.write_text(
        json.dumps({"query": "钥匙有什么作用？", "positive": "生锈的钥匙可以打开铁门。"}, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )
    hashes = {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in (train_path, validation_path)
    }
    (root / "manifest.json").write_text(
        json.dumps({"seed": seed, "sha256": hashes}, ensure_ascii=False),
        encoding="utf-8",
    )
    return train_path, validation_path


def test_default_config_is_small_single_gpu():
    config = TrainingConfig()

    assert config.model_name == "BAAI/bge-small-zh-v1.5"
    assert config.seed == 8503
    assert config.epochs == 3
    assert config.max_seq_length <= 512


def test_training_module_keeps_heavy_dependencies_lazy():
    source = Path(train_module.__file__).read_text(encoding="utf-8")
    prefix = source.split("def import_training_stack", 1)[0]

    assert "sentence_transformers" not in prefix
    assert "from datasets" not in prefix
    assert "import torch" not in prefix


def test_training_data_is_bound_to_manifest_and_uses_only_pairs(tmp_path: Path):
    data_dir = tmp_path / "data"
    write_dataset(data_dir)

    data = load_training_data(data_dir, expected_seed=8503)

    assert data.seed == 8503
    assert data.train_pairs == [("钟停在几点？", "铜钟停在十一点四十七分。")]
    assert data.validation_pairs == [("钥匙有什么作用？", "生锈的钥匙可以打开铁门。")]
    assert len(data.train_sha256) == 64
    assert len(data.validation_sha256) == 64
    assert len(data.manifest_sha256) == 64


def test_training_data_rejects_seed_or_hash_mismatch(tmp_path: Path):
    data_dir = tmp_path / "data"
    train_path, _ = write_dataset(data_dir)

    with pytest.raises(ValueError, match="seed"):
        load_training_data(data_dir, expected_seed=7)

    train_path.write_text('{"query":"changed","positive":"changed"}\n', encoding="utf-8")
    with pytest.raises(ValueError, match="SHA-256"):
        load_training_data(data_dir, expected_seed=8503)


@pytest.mark.parametrize("split", ["train", "validation"])
def test_training_data_rejects_empty_pair_fields(tmp_path: Path, split: str):
    data_dir = tmp_path / "data"
    train_path, validation_path = write_dataset(data_dir)
    path = train_path if split == "train" else validation_path
    path.write_text('{"query":"","positive":"answer"}\n', encoding="utf-8")
    manifest = json.loads((data_dir / "manifest.json").read_text(encoding="utf-8"))
    manifest["sha256"][path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    (data_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(ValueError, match=f"{split}.*non-empty"):
        load_training_data(data_dir)


def test_training_metadata_records_actual_parameters_and_hashes(tmp_path: Path):
    data_dir = tmp_path / "data"
    write_dataset(data_dir)
    data = load_training_data(data_dir)
    config = TrainingConfig(batch_size=2, output_dir=tmp_path / "model")

    metadata = train_module.build_training_metadata(config, data)

    assert metadata["method"] == "sentence-transformers contrastive fine-tuning"
    assert metadata["loss"] == "MultipleNegativesRankingLoss"
    assert metadata["negative_source"] == "in-batch only"
    assert metadata["actual_parameters"]["batch_size"] == 2
    assert metadata["data"]["train_sha256"] == data.train_sha256
    assert metadata["data"]["manifest_sha256"] == data.manifest_sha256


def test_direct_cli_check_only_does_not_need_training_dependencies(tmp_path: Path):
    data_dir = tmp_path / "data"
    write_dataset(data_dir)
    script = Path(train_module.__file__)

    result = subprocess.run(
        [
            sys.executable,
            "-B",
            str(script),
            "--data",
            str(data_dir),
            "--device",
            "cpu",
            "--batch-size",
            "2",
            "--check-only",
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["actual_parameters"]["batch_size"] == 2
    assert payload["actual_parameters"]["device"] == "cpu"


def fake_training_stack(*, fail_reload: bool):
    class FakeCuda:
        @staticmethod
        def is_available():
            return False

        @staticmethod
        def manual_seed_all(_seed):
            raise AssertionError("CUDA seeding must not run for a CPU-only stack")

    class FakeTorch:
        cuda = FakeCuda()

        @staticmethod
        def manual_seed(_seed):
            return None

    class FakeDataset:
        @staticmethod
        def from_dict(payload):
            return payload

    class FakeModel:
        calls = 0

        def __init__(self, _name, device):
            type(self).calls += 1
            if fail_reload and type(self).calls == 2:
                raise RuntimeError("injected reload failure")
            self.device = device
            self.max_seq_length = 512

        def save_pretrained(self, output):
            (Path(output) / "fake-model.txt").write_text("saved", encoding="utf-8")

    class FakeTrainer:
        def __init__(self, **_kwargs):
            pass

        def train(self):
            return None

    class FakeArguments:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class FakeLosses:
        @staticmethod
        def MultipleNegativesRankingLoss(_model):
            return object()

    class FakeBatchSamplers:
        NO_DUPLICATES = "no-duplicates"

    return (
        FakeTorch,
        FakeDataset,
        FakeModel,
        FakeTrainer,
        FakeArguments,
        FakeLosses,
        FakeBatchSamplers,
    )


def test_completion_marker_is_written_only_after_successful_reload(tmp_path: Path, monkeypatch):
    data_dir = tmp_path / "data"
    write_dataset(data_dir)
    data = load_training_data(data_dir)
    output_dir = tmp_path / "model"
    config = TrainingConfig(output_dir=output_dir, device="cpu", max_steps=1)
    monkeypatch.setattr(train_module, "import_training_stack", lambda: fake_training_stack(fail_reload=True))

    with pytest.raises(RuntimeError, match="reload"):
        train_module.train(config, data)

    assert (output_dir / "training-config.json").exists()
    assert not (output_dir / "training-complete.json").exists()

    monkeypatch.setattr(train_module, "import_training_stack", lambda: fake_training_stack(fail_reload=False))
    train_module.train(config, data)

    completion = json.loads((output_dir / "training-complete.json").read_text(encoding="utf-8"))
    assert completion["status"] == "complete"
    assert completion["manifest_sha256"] == data.manifest_sha256
