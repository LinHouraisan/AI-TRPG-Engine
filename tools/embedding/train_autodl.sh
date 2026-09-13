#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python}"
DATA_DIR="${EMBEDDING_DATA_DIR:-${SCRIPT_DIR}/data}"
OUTPUT_DIR="${EMBEDDING_OUTPUT_DIR:-${SCRIPT_DIR}/saves/bge-small-zh-trpg}"
DEVICE="cuda"

args=("$@")
for ((index = 0; index < ${#args[@]}; index++)); do
  case "${args[$index]}" in
    --data)
      ((index + 1 < ${#args[@]})) || { echo "--data 缺少参数" >&2; exit 2; }
      DATA_DIR="${args[$((index + 1))]}"
      ;;
    --data=*) DATA_DIR="${args[$index]#--data=}" ;;
    --output)
      ((index + 1 < ${#args[@]})) || { echo "--output 缺少参数" >&2; exit 2; }
      OUTPUT_DIR="${args[$((index + 1))]}"
      ;;
    --output=*) OUTPUT_DIR="${args[$index]#--output=}" ;;
    --device)
      ((index + 1 < ${#args[@]})) || { echo "--device 缺少参数" >&2; exit 2; }
      DEVICE="${args[$((index + 1))]}"
      ;;
    --device=*) DEVICE="${args[$index]#--device=}" ;;
  esac
done

command -v "${PYTHON_BIN}" >/dev/null 2>&1 || { echo "找不到 Python: ${PYTHON_BIN}" >&2; exit 1; }
for name in train.jsonl validation.jsonl manifest.json; do
  [[ -f "${DATA_DIR}/${name}" ]] || { echo "缺少训练数据: ${DATA_DIR}/${name}" >&2; exit 1; }
done

"${PYTHON_BIN}" -c 'import datasets, sentence_transformers, torch' || {
  echo "训练依赖缺失；请显式执行: python -m pip install -r tools/embedding/requirements.txt" >&2
  exit 1
}
if [[ "${DEVICE}" == cuda* ]]; then
  "${PYTHON_BIN}" -c 'import torch; raise SystemExit(0 if torch.cuda.is_available() else 1)' || {
    echo "请求了 CUDA，但 PyTorch 未检测到可用 GPU" >&2
    exit 1
  }
fi

mkdir -p "${OUTPUT_DIR}"
LOG_FILE="${OUTPUT_DIR}/training.log"
cd "${REPO_ROOT}"
"${PYTHON_BIN}" "${SCRIPT_DIR}/train.py" --data "${DATA_DIR}" --output "${OUTPUT_DIR}" "${args[@]}" 2>&1 | tee "${LOG_FILE}"
