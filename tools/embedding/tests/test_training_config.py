import hashlib
import json
import os
from pathlib import Path
import shutil
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
            "--output",
            str(tmp_path / "model"),
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
    assert not (tmp_path / "model").exists()


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


def test_main_invalidates_old_marker_before_manifest_validation(tmp_path: Path, monkeypatch):
    data_dir = tmp_path / "data"
    train_path, _ = write_dataset(data_dir)
    train_path.write_text('{"query":"changed","positive":"changed"}\n', encoding="utf-8")
    output_dir = tmp_path / "model"
    output_dir.mkdir()
    marker = output_dir / "training-complete.json"
    marker.write_text('{"status":"old"}', encoding="utf-8")
    monkeypatch.setattr(
        sys,
        "argv",
        ["train", "--data", str(data_dir), "--output", str(output_dir), "--device", "cpu"],
    )

    with pytest.raises(ValueError, match="SHA-256"):
        train_module.main()

    assert not marker.exists()


def test_main_invalidates_old_marker_before_dependency_import(tmp_path: Path, monkeypatch):
    data_dir = tmp_path / "data"
    write_dataset(data_dir)
    output_dir = tmp_path / "model"
    output_dir.mkdir()
    marker = output_dir / "training-complete.json"
    marker.write_text('{"status":"old"}', encoding="utf-8")
    monkeypatch.setattr(
        sys,
        "argv",
        ["train", "--data", str(data_dir), "--output", str(output_dir), "--device", "cpu"],
    )
    monkeypatch.setattr(
        train_module,
        "import_training_stack",
        lambda: (_ for _ in ()).throw(ModuleNotFoundError("datasets")),
    )

    with pytest.raises(ModuleNotFoundError, match="datasets"):
        train_module.main()

    assert not marker.exists()


def find_bash() -> str:
    discovered = shutil.which("bash")
    if discovered:
        return discovered
    candidate = Path(r"C:\Program Files\Git\bin\bash.exe")
    if candidate.exists():
        return str(candidate)
    pytest.skip("bash is unavailable")


def run_autodl(args: list[str], *, cwd: Path, env: dict[str, str] | None = None):
    script = Path(train_module.__file__).with_name("train_autodl.sh")
    return subprocess.run(
        [find_bash(), str(script), *args],
        cwd=cwd,
        env={**os.environ, **(env or {})},
        capture_output=True,
        text=True,
        check=False,
    )


def write_mock_command(path: Path, body: str) -> Path:
    path.write_text("#!/usr/bin/env bash\n" + body, encoding="utf-8", newline="\n")
    path.chmod(0o755)
    return path


def test_autodl_check_only_skips_heavy_preflight_and_output_creation(tmp_path: Path):
    data_dir = tmp_path / "data"
    write_dataset(data_dir)
    output_dir = tmp_path / "unused-output"

    result = run_autodl(
        [
            "--data",
            data_dir.as_posix(),
            "--output",
            output_dir.as_posix(),
            "--device",
            "cpu",
            "--check-only",
        ],
        cwd=tmp_path,
    )

    assert result.returncode == 0, result.stderr
    assert not output_dir.exists()


def test_autodl_normalizes_relative_output_and_propagates_python_failure(tmp_path: Path):
    data_dir = tmp_path / "data"
    write_dataset(data_dir)
    calls = tmp_path / "calls.txt"
    fake_python = write_mock_command(
        tmp_path / "fake-python",
        'if [[ "$1" == "-c" ]]; then exit 0; fi\n'
        'printf "%s\\n" "$*" >> "$MOCK_CALLS"\n'
        'exit 7\n',
    )
    relative_output = Path("relative") / "model"
    absolute_output = tmp_path / relative_output
    absolute_output.mkdir(parents=True)
    (absolute_output / "training-complete.json").write_text("old", encoding="utf-8")

    result = run_autodl(
        ["--data", data_dir.as_posix(), "--output", relative_output.as_posix(), "--device", "cpu"],
        cwd=tmp_path,
        env={"PYTHON_BIN": fake_python.as_posix(), "MOCK_CALLS": calls.as_posix()},
    )

    assert result.returncode == 7
    assert not (absolute_output / "training-complete.json").exists()
    assert (absolute_output / "training.log").exists()
    invocation = calls.read_text(encoding="utf-8")
    assert "--output relative/model" not in invocation
    assert invocation.rstrip().endswith("/relative/model")


def test_autodl_log_failure_removes_marker_without_starting_python(tmp_path: Path):
    data_dir = tmp_path / "data"
    write_dataset(data_dir)
    output_dir = tmp_path / "model"
    output_dir.mkdir()
    (output_dir / "training-complete.json").write_text("old", encoding="utf-8")
    (output_dir / "training.log").mkdir()
    calls = tmp_path / "calls.txt"
    fake_python = write_mock_command(
        tmp_path / "fake-python",
        'printf "%s\\n" "$*" >> "$MOCK_CALLS"\nexit 0\n',
    )

    result = run_autodl(
        ["--data", data_dir.as_posix(), "--output", output_dir.as_posix(), "--device", "cpu"],
        cwd=tmp_path,
        env={"PYTHON_BIN": fake_python.as_posix(), "MOCK_CALLS": calls.as_posix()},
    )

    assert result.returncode != 0
    assert not (output_dir / "training-complete.json").exists()
    assert not calls.exists()


def test_autodl_dependency_failure_removes_marker_and_checks_accelerate(tmp_path: Path):
    data_dir = tmp_path / "data"
    write_dataset(data_dir)
    output_dir = tmp_path / "model"
    output_dir.mkdir()
    marker = output_dir / "training-complete.json"
    marker.write_text("old", encoding="utf-8")
    fake_python = write_mock_command(
        tmp_path / "fake-python",
        'if [[ "$1" == "-c" && "$2" == *accelerate* ]]; then exit 3; fi\nexit 5\n',
    )

    result = run_autodl(
        ["--data", data_dir.as_posix(), "--output", output_dir.as_posix(), "--device", "cpu"],
        cwd=tmp_path,
        env={"PYTHON_BIN": fake_python.as_posix()},
    )

    assert result.returncode == 1
    assert not marker.exists()
    assert "训练依赖缺失" in result.stderr


def test_autodl_propagates_tee_failure(tmp_path: Path):
    data_dir = tmp_path / "data"
    write_dataset(data_dir)
    fake_python = write_mock_command(
        tmp_path / "fake-python",
        'if [[ "$1" == "-c" ]]; then exit 0; fi\necho training\nexit 0\n',
    )
    fake_tee = write_mock_command(tmp_path / "fake-tee", "exit 9\n")

    result = run_autodl(
        ["--data", data_dir.as_posix(), "--output", "model", "--device", "cpu"],
        cwd=tmp_path,
        env={"PYTHON_BIN": fake_python.as_posix(), "TEE_BIN": fake_tee.as_posix()},
    )

    assert result.returncode == 9
