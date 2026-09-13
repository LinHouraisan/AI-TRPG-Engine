from pathlib import Path
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


def _write_config(path: Path, *, model: str, adapter: Path) -> None:
    path.write_text(
        textwrap.dedent(
            f"""
            model_name_or_path: {model}
            dataset: trpg_dm_train
            eval_dataset: trpg_dm_validation
            dataset_dir: "{DATA_DIR.as_posix()}"
            output_dir: "{adapter.as_posix()}"
            """
        ).strip()
        + "\n",
        encoding="utf-8",
    )


def _write_executable(path: Path, source: str) -> None:
    path.write_text(source, encoding="utf-8", newline="\n")
    path.chmod(0o755)


def test_cloud_script_is_portable_and_validates_the_real_pipeline():
    source = SCRIPT.read_text(encoding="utf-8")

    assert "/root/autodl-tmp" not in source
    assert "--check-only" in source
    assert "prepare_dataset.py" in source
    assert "dataset_info.json" in source
    assert '"$LLAMAFACTORY_CLI" train "$CONFIG_PATH"' in source
    assert "adapter_config.json" in source
    assert "trainer_state.json" in source
    assert "merge_lora.py" in source
    assert "nvidia-smi" in source


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
