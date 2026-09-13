from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "train_autodl.sh"


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
