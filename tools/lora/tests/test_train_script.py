from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import textwrap

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / "train_autodl.sh"
DATA_DIR = SCRIPT.parent / "data"


def _bash() -> str:
    bash = shutil.which("bash")
    if not bash and os.name == "nt":
        git_bash = Path("C:/Program Files/Git/bin/bash.exe")
        bash = str(git_bash) if git_bash.is_file() else None
    if not bash:
        pytest.skip("当前环境没有 Bash")
    return bash


def _write_config(path: Path, *, model: str, adapter: Path, data_dir: Path = DATA_DIR) -> None:
    path.write_text(
        textwrap.dedent(
            f"""
            model_name_or_path: {model}
            dataset: trpg_dm_train
            eval_dataset: trpg_dm_validation
            dataset_dir: "{data_dir.as_posix()}"
            output_dir: "{adapter.as_posix()}"
            """
        ).strip()
        + "\n",
        encoding="utf-8",
    )


def _write_executable(path: Path, source: str) -> None:
    path.write_text(source, encoding="utf-8", newline="\n")
    path.chmod(0o755)


def _write_curated_candidates(path: Path) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = [
        {
            "instruction": "主持人",
            "input": f"人工筛选行动 {index}",
            "output": f"人工修订标记 {index}。你要怎么做？",
            "meta": {
                "source": "api-model" if index == 0 else "human-authored",
                "visibility": "player",
                "pack": "curated",
                "kind": "room",
                "entity_id": f"loc.{index}",
                "group": f"curated:room:loc.{index}",
                "family_group": f"curated:family:{index}",
            },
        }
        for index in range(5)
    ]
    content = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
    path.write_text(content, encoding="utf-8")
    return content


def test_cloud_script_is_portable_and_validates_the_real_pipeline():
    source = SCRIPT.read_text(encoding="utf-8")

    assert "/root/autodl-tmp" not in source
    assert "--check-only" in source
    assert "prepare_dataset.py" in source
    assert "synth_lora_data.py" in source
    assert "LORA_DATA_DIR" in source
    assert "dataset_info.json" in source
    assert '"$LLAMAFACTORY_CLI" train "$CONFIG_PATH"' in source
    assert "adapter_config.json" in source
    assert "trainer_state.json" in source
    assert "merge_lora.py" in source
    assert "nvidia-smi" in source


def test_check_only_builds_and_validates_a_fresh_offline_dataset(tmp_path: Path):
    data_dir = tmp_path / "fresh-data"
    config = tmp_path / "train.yaml"
    _write_config(
        config,
        model="Qwen/Qwen2.5-3B-Instruct",
        adapter=tmp_path / "adapter",
        data_dir=data_dir,
    )

    result = subprocess.run(
        [_bash(), str(SCRIPT), "--check-only"],
        cwd=SCRIPT.parents[2],
        env={
            **os.environ,
            "LORA_CONFIG": str(config),
            "LORA_DATA_DIR": str(data_dir),
            "LORA_LORE_ROOT": str(SCRIPT.parents[2] / "electron" / "content" / "packs"),
            "LORA_TOTAL": "40",
        },
        capture_output=True,
        text=True,
        encoding="utf-8",
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert (data_dir / "train.jsonl").is_file()
    assert (data_dir / "candidate_manifest.json").is_file()
    assert (data_dir / "train.sft.jsonl").is_file()
    assert (data_dir / "validation.sft.jsonl").is_file()
    assert (data_dir / "test.prompts.jsonl").is_file()
    registry = json.loads((data_dir / "dataset_info.json").read_text(encoding="utf-8"))
    assert registry["trpg_dm_train"]["file_name"] == "train.sft.jsonl"
    assert registry["trpg_dm_validation"]["file_name"] == "validation.sft.jsonl"


@pytest.mark.parametrize(
    ("args", "expected_code"),
    [(["--check-only"], 0), ([], 1)],
)
def test_existing_curated_candidates_are_preserved_and_prepared(tmp_path: Path, args, expected_code):
    data_dir = tmp_path / "curated-data"
    candidate_path = data_dir / "train.jsonl"
    original = _write_curated_candidates(candidate_path)
    config = tmp_path / "train.yaml"
    _write_config(
        config,
        model="Qwen/Qwen2.5-3B-Instruct",
        adapter=tmp_path / "adapter",
        data_dir=data_dir,
    )

    result = subprocess.run(
        [_bash(), str(SCRIPT), *args],
        cwd=SCRIPT.parents[2],
        env={
            **os.environ,
            "LORA_CONFIG": str(config),
            "LORA_DATA_DIR": str(data_dir),
            "LLAMAFACTORY_CLI": "missing-llamafactory-for-preflight-test",
        },
        capture_output=True,
        text=True,
        encoding="utf-8",
    )

    prepared_text = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (
            data_dir / "train.sft.jsonl",
            data_dir / "validation.sft.jsonl",
            data_dir / "test.prompts.jsonl",
        )
    )
    assert result.returncode == expected_code, result.stdout + result.stderr
    assert candidate_path.read_text(encoding="utf-8") == original
    assert "保留已有候选数据" in result.stdout
    assert "人工修订标记 0" in prepared_text


def test_rebuild_data_explicitly_replaces_candidates_deterministically(tmp_path: Path):
    data_dir = tmp_path / "rebuilt-data"
    candidate_path = data_dir / "train.jsonl"
    _write_curated_candidates(candidate_path)
    config = tmp_path / "train.yaml"
    _write_config(
        config,
        model="Qwen/Qwen2.5-3B-Instruct",
        adapter=tmp_path / "adapter",
        data_dir=data_dir,
    )
    env = {
        **os.environ,
        "LORA_CONFIG": str(config),
        "LORA_DATA_DIR": str(data_dir),
        "LORA_LORE_ROOT": str(SCRIPT.parents[2] / "electron" / "content" / "packs"),
        "LORA_TOTAL": "40",
    }

    first = subprocess.run(
        [_bash(), str(SCRIPT), "--rebuild-data", "--check-only"],
        cwd=SCRIPT.parents[2],
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    first_content = candidate_path.read_text(encoding="utf-8")
    _write_curated_candidates(candidate_path)
    second = subprocess.run(
        [_bash(), str(SCRIPT), "--check-only", "--rebuild-data"],
        cwd=SCRIPT.parents[2],
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )

    assert first.returncode == 0, first.stdout + first.stderr
    assert second.returncode == 0, second.stdout + second.stderr
    assert "显式重建候选数据" in first.stdout
    assert "人工修订标记" not in first_content
    assert candidate_path.read_text(encoding="utf-8") == first_content


def test_unknown_argument_fails_even_when_combined_with_valid_flags():
    result = subprocess.run(
        [_bash(), str(SCRIPT), "--check-only", "--unknown"],
        cwd=SCRIPT.parents[2],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )

    assert result.returncode == 2
    assert "未知参数" in result.stderr


def test_cloud_script_does_not_install_upload_or_publish():
    source = SCRIPT.read_text(encoding="utf-8")

    forbidden = ("pip install", "git clone", "git push", "huggingface-cli upload", "hf upload")
    assert all(command not in source for command in forbidden)


def test_check_only_accepts_an_existing_relative_model_directory(tmp_path: Path):
    model_dir = tmp_path / "models" / "qwen"
    model_dir.mkdir(parents=True)
    (model_dir / "config.json").write_text("{}\n", encoding="utf-8")
    config = tmp_path / "train.yaml"
    _write_config(config, model="models/qwen", adapter=tmp_path / "adapter")

    result = subprocess.run(
        [_bash(), str(SCRIPT), "--check-only"],
        cwd=SCRIPT.parents[2],
        env={**os.environ, "LORA_CONFIG": str(config)},
        capture_output=True,
        text=True,
        encoding="utf-8",
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert str(model_dir.resolve()) in result.stdout


def test_failing_tee_propagates_failure_without_printing_success(tmp_path: Path):
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    adapter = tmp_path / "adapter"
    merged = tmp_path / "merged"
    config = tmp_path / "train.yaml"
    _write_config(config, model="Qwen/Qwen2.5-3B-Instruct", adapter=adapter)

    _write_executable(
        fake_bin / "llamafactory-cli",
        """#!/usr/bin/env bash
set -e
mkdir -p "$TEST_ADAPTER_DIR"
printf '{}\n' > "$TEST_ADAPTER_DIR/adapter_config.json"
printf 'adapter\n' > "$TEST_ADAPTER_DIR/adapter_model.safetensors"
printf '{"global_step":1,"log_history":[{"epoch":1,"train_loss":0.5}]}\n' > "$TEST_ADAPTER_DIR/trainer_state.json"
echo 'mock train complete'
""",
    )
    _write_executable(
        fake_bin / "nvidia-smi",
        "#!/usr/bin/env bash\necho 'Mock GPU, 24576 MiB, 1.0'\n",
    )
    _write_executable(
        fake_bin / "tee",
        "#!/usr/bin/env bash\n/usr/bin/tee \"$@\"\nexit 1\n",
    )
    _write_executable(
        fake_bin / "python",
        """#!/usr/bin/env bash
set -e
if [[ "${1:-}" == *'/merge_lora.py' ]]; then
  mkdir -p "$TEST_MERGED_DIR"
  printf '{}\n' > "$TEST_MERGED_DIR/config.json"
  printf 'model\n' > "$TEST_MERGED_DIR/model-test.safetensors"
  echo 'mock merge complete'
  exit 0
fi
exec "$REAL_PYTHON" "$@"
""",
    )
    env = {
        **os.environ,
        "PATH": f"{fake_bin}{os.pathsep}{os.environ.get('PATH', '')}",
        "REAL_PYTHON": sys.executable,
        "TEST_ADAPTER_DIR": str(adapter),
        "TEST_MERGED_DIR": str(merged),
        "LORA_CONFIG": str(config),
        "LORA_MERGED_DIR": str(merged),
        "LORA_LOG_DIR": str(tmp_path / "logs"),
        "LORA_RUN_ID": "tee-failure-test",
        "LORA_TEE_COMMAND": (fake_bin / "tee").as_posix(),
    }

    result = subprocess.run(
        [_bash(), str(SCRIPT)],
        cwd=SCRIPT.parents[2],
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    output = result.stdout + result.stderr

    assert result.returncode != 0
    assert "mock merge complete" in output, output
    assert "训练输出未能可靠写入日志" in output
    assert "训练及合并完成。" not in output
