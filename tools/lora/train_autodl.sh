#!/usr/bin/env bash
# 在单卡云实例上准备数据、训练 Qwen2.5-3B 文风 LoRA，并合并 Adapter。
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_PATH="${LORA_CONFIG:-$SCRIPT_DIR/lora_qwen3b.yaml}"
DATA_DIR="$SCRIPT_DIR/data"
MERGED_DIR="${LORA_MERGED_DIR:-$SCRIPT_DIR/merged-qwen2.5-3b-trpg}"
LOG_DIR="${LORA_LOG_DIR:-$SCRIPT_DIR/logs}"
LLAMAFACTORY_CLI="${LLAMAFACTORY_CLI:-llamafactory-cli}"
TEE_COMMAND="${LORA_TEE_COMMAND:-tee}"
CHECK_ONLY=false

if [[ "${1:-}" == "--check-only" ]]; then
  CHECK_ONLY=true
elif [[ $# -ne 0 ]]; then
  echo "用法：bash train_autodl.sh [--check-only]" >&2
  exit 2
fi

for path in "$CONFIG_PATH" "$SCRIPT_DIR/prepare_dataset.py" "$SCRIPT_DIR/merge_lora.py" \
  "$DATA_DIR/train.jsonl" "$DATA_DIR/seeds.jsonl" "$DATA_DIR/dataset_info.json"; do
  if [[ ! -f "$path" ]]; then
    echo "缺少必需文件：$path" >&2
    exit 1
  fi
done
command -v python >/dev/null 2>&1 || { echo "缺少 python" >&2; exit 1; }

echo "==> 1/4 按固定 seed 生成训练、验证和测试切分"
python "$SCRIPT_DIR/prepare_dataset.py" \
  --input "$DATA_DIR/train.jsonl" \
  --seeds "$DATA_DIR/seeds.jsonl" \
  --out "$DATA_DIR" \
  --seed 8503

echo "==> 2/4 校验 LLaMA-Factory 数据注册和配置"
RUN_OUTPUT="$(python - "$CONFIG_PATH" <<'PY'
import json
from pathlib import Path
import sys

config_path = Path(sys.argv[1]).resolve()


def top_level_yaml(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, value = line.split(":", 1)
        if raw_line[:1].isspace():
            continue
        values[key.strip()] = value.strip().strip("'\"")
    return values


config = top_level_yaml(config_path)
required = ("model_name_or_path", "dataset", "eval_dataset", "dataset_dir", "output_dir")
missing = [key for key in required if not config.get(key)]
if missing:
    raise SystemExit(f"训练配置缺少字段：{', '.join(missing)}")

data_dir = (config_path.parent / config["dataset_dir"]).resolve()
info_path = data_dir / "dataset_info.json"
if not info_path.is_file():
    raise SystemExit(f"缺少数据注册文件：{info_path}")
dataset_info = json.loads(info_path.read_text(encoding="utf-8"))

specs = (
    (config["dataset"], ("instruction", "input", "output")),
    (config["eval_dataset"], ("instruction", "input", "output")),
)
counts: dict[str, int] = {}
for dataset_name, fields in specs:
    registration = dataset_info.get(dataset_name)
    if not isinstance(registration, dict) or not registration.get("file_name"):
        raise SystemExit(f"dataset_info.json 未注册数据集：{dataset_name}")
    expected_columns = {"prompt": "instruction", "query": "input", "response": "output"}
    if registration.get("columns") != expected_columns:
        raise SystemExit(f"dataset_info.json 的 {dataset_name} 字段映射不正确")
    data_path = data_dir / registration["file_name"]
    if not data_path.is_file():
        raise SystemExit(f"数据集文件不存在：{data_path}")
    rows = []
    for line_number, line in enumerate(data_path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"{data_path}:{line_number} 不是合法 JSON：{exc}") from exc
        if any(not isinstance(row.get(field), str) or not row[field].strip() for field in fields):
            raise SystemExit(f"{data_path}:{line_number} 缺少非空 Alpaca 字段")
        rows.append(row)
    if not rows:
        raise SystemExit(f"数据集不能为空：{data_path}")
    counts[dataset_name] = len(rows)

test_path = data_dir / "test.prompts.jsonl"
if not test_path.is_file():
    raise SystemExit(f"测试集不能为空：{test_path}")
test_rows = []
for line_number, line in enumerate(test_path.read_text(encoding="utf-8").splitlines(), 1):
    if not line.strip():
        continue
    try:
        row = json.loads(line)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{test_path}:{line_number} 不是合法 JSON：{exc}") from exc
    fields = ("prompt", "reference_output", "source", "group")
    if any(not isinstance(row.get(field), str) or not row[field].strip() for field in fields):
        raise SystemExit(f"{test_path}:{line_number} 缺少非空评测字段")
    test_rows.append(row)
if not test_rows:
    raise SystemExit(f"测试集不能为空：{test_path}")

model_ref = config["model_name_or_path"]
local_model = Path(model_ref).expanduser()
if not local_model.is_absolute():
    local_model = config_path.parent / local_model
local_model = local_model.resolve()
if model_ref.startswith(("/", "./", "../", "~")) or local_model.exists():
    if not (local_model / "config.json").is_file():
        raise SystemExit(f"本地基座模型不存在或不完整：{local_model}")
    model_ref = str(local_model)

adapter_dir = (config_path.parent / config["output_dir"]).resolve()
print(model_ref)
print(adapter_dir)
print(
    f"train={counts[config['dataset']]} "
    f"validation={counts[config['eval_dataset']]} test={len(test_rows)}"
)
PY
)"
readarray -t RUN_VALUES <<<"$RUN_OUTPUT"

BASE_MODEL="${RUN_VALUES[0]}"
ADAPTER_DIR="${RUN_VALUES[1]}"
if command -v cygpath >/dev/null 2>&1; then
  ADAPTER_DIR="$(cygpath -u "$ADAPTER_DIR")"
  MERGED_DIR="$(cygpath -u "$MERGED_DIR")"
  LOG_DIR="$(cygpath -u "$LOG_DIR")"
fi
echo "数据校验通过：${RUN_VALUES[2]}"
echo "基座模型：$BASE_MODEL"
echo "Adapter 目录：$ADAPTER_DIR"

if [[ "$CHECK_ONLY" == true ]]; then
  echo "本地数据和配置检查完成；尚未训练，也未生成任何评测报告。"
  exit 0
fi

command -v "$LLAMAFACTORY_CLI" >/dev/null 2>&1 || {
  echo "缺少 $LLAMAFACTORY_CLI；请先按 README 安装并固定 LLaMA-Factory 版本。" >&2
  exit 1
}
command -v nvidia-smi >/dev/null 2>&1 || { echo "缺少 nvidia-smi，正式训练必须在 NVIDIA GPU 实例运行。" >&2; exit 1; }
command -v "$TEE_COMMAND" >/dev/null 2>&1 || { echo "缺少 tee，无法可靠保存训练日志。" >&2; exit 1; }
GPU_INFO="$(nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader)"
if [[ -z "$GPU_INFO" ]]; then
  echo "未检测到可用 NVIDIA GPU。" >&2
  exit 1
fi
if [[ -e "$MERGED_DIR" ]]; then
  echo "合并输出已存在，为避免覆盖请移走它或设置新的 LORA_MERGED_DIR：$MERGED_DIR" >&2
  exit 1
fi

mkdir -p "$LOG_DIR"
RUN_ID="${LORA_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
LOG_FILE="$LOG_DIR/train-$RUN_ID.log"

run_training() {
  echo "==> 训练运行：$RUN_ID"
  echo "GPU：$GPU_INFO"
  echo "配置：$CONFIG_PATH"
  echo "数据：${RUN_VALUES[2]}"
  echo "LLaMA-Factory：$(command -v "$LLAMAFACTORY_CLI")"

  echo "==> 3/4 训练 Adapter"
  (
    cd "$SCRIPT_DIR"
    "$LLAMAFACTORY_CLI" train "$CONFIG_PATH"
  ) || return $?
  if [[ ! -f "$ADAPTER_DIR/adapter_config.json" ]] || \
    ! compgen -G "$ADAPTER_DIR/adapter_model.*" >/dev/null; then
    echo "训练命令结束，但 Adapter 产物不完整：$ADAPTER_DIR" >&2
    return 1
  fi
  python - "$ADAPTER_DIR/trainer_state.json" <<'PY' || return $?
import json
from pathlib import Path
import sys

state_path = Path(sys.argv[1])
if not state_path.is_file():
    raise SystemExit(f"训练完成但缺少 trainer_state.json：{state_path}")
state = json.loads(state_path.read_text(encoding="utf-8"))
history = state.get("log_history") or []
summary = next((row for row in reversed(history) if "train_loss" in row), None)
if summary is None:
    summary = next((row for row in reversed(history) if "loss" in row), None)
if summary is None:
    raise SystemExit("trainer_state.json 未记录 loss，不能形成可审计训练日志")
print(
    "训练摘要："
    f"epoch={summary.get('epoch', state.get('epoch', 'unknown'))} "
    f"loss={summary.get('train_loss', summary.get('loss'))} "
    f"global_step={state.get('global_step', 'unknown')}"
)
PY

  echo "==> 4/4 合并 Adapter"
  python "$SCRIPT_DIR/merge_lora.py" \
    --base "$BASE_MODEL" \
    --adapter "$ADAPTER_DIR" \
    --out "$MERGED_DIR" || return $?
  if [[ ! -f "$MERGED_DIR/config.json" ]] || \
    ! compgen -G "$MERGED_DIR/model*.safetensors" >/dev/null; then
    echo "合并命令结束，但模型产物不完整：$MERGED_DIR" >&2
    return 1
  fi
}

set +e
(set -euo pipefail; run_training) 2>&1 | "$TEE_COMMAND" -a "$LOG_FILE"
PIPELINE_STATUS=("${PIPESTATUS[@]}")
set -e
if [[ "${PIPELINE_STATUS[0]}" -ne 0 ]]; then
  echo "训练或合并失败；检查日志：$LOG_FILE" >&2
  exit "${PIPELINE_STATUS[0]}"
fi
if [[ "${PIPELINE_STATUS[1]}" -ne 0 ]]; then
  echo "训练输出未能可靠写入日志：$LOG_FILE" >&2
  exit "${PIPELINE_STATUS[1]}"
fi

echo "训练及合并完成。"
echo "Adapter：$ADAPTER_DIR"
echo "合并模型：$MERGED_DIR"
echo "完整日志：$LOG_FILE"
echo "下一步按 README 启动 base/RAG/LoRA 端点并生成真实评测报告。"
