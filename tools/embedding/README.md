# TRPG 领域 Embedding 对比学习

本目录把 `BAAI/bge-small-zh-v1.5` 在 TRPG 内容包合成数据上做
Sentence Transformers 对比学习微调。它不是 LoRA；收益只能在同一基座的
微调前后、同一测试集上比较，不能拿当前应用使用的 `bge-m3` 横向差异冒充
训练收益。

## 当前真实状态

- 数据构建、困难负样本挖掘、纯 IR 指标和训练入口已实现。
- 本提交没有下载模型、没有跑完训练，也没有产生任何 tuned 指标或模型权重。
- `tools/embedding/data/`、`tools/embedding/saves/` 和训练日志是本地产物，不提交。

## 数据与训练边界

先在仓库根目录生成固定数据：

```bash
python tools/embedding/build_dataset.py \
  --packs electron/content/packs \
  --output tools/embedding/data \
  --seed 8503
```

训练入口会先读取 `manifest.json`，并对 seed、`train.jsonl` 与
`validation.jsonl` 的 SHA-256 做 fail-closed 校验。任何缺项或不匹配都会在
加载模型前失败。训练数据只取每行的 `query` 与 `positive`；即使文件里含有
`negative` 或 `negative_id`，本入口也不会消费它们。当前 loss 是
`MultipleNegativesRankingLoss`，负样本来自同一训练 batch 内的其他正样本，
因此不会把其他 split 的文档误当训练负样本。

`documents.jsonl` 保留作者字段，可能含主持人秘密，仅供训练与离线评测，
绝不能直接接入玩家侧检索索引。

## AutoDL 单卡运行

脚本不会自动安装依赖。先在云端环境中显式安装：

```bash
python -m pip install -r tools/embedding/requirements.txt
```

只校验配置、数据和来源证明（不导入训练依赖、不检查 GPU、不创建输出目录或日志）：

```bash
python tools/embedding/train.py \
  --data tools/embedding/data \
  --output tools/embedding/saves/bge-small-zh-trpg \
  --check-only
```

确认 AutoDL 环境的 Python、依赖、CUDA 和数据均可用后训练：

```bash
bash tools/embedding/train_autodl.sh --batch-size 16
```

也可以通过包装脚本执行同一轻量检查；`--device cpu` 不会触发 CUDA 检查：

```bash
bash tools/embedding/train_autodl.sh --device cpu --check-only
```

显存不足时只降低 batch，不改变 seed 或切分：

```bash
bash tools/embedding/train_autodl.sh --batch-size 8
```

CPU 的单步 smoke 仅应在模型已缓存、依赖已安装时运行：

```bash
python tools/embedding/train.py \
  --data tools/embedding/data \
  --output .tmp/embedding-smoke \
  --max-steps 1 \
  --device cpu
```

正式训练一开始就会删除输出目录内任何旧的 `training-complete.json`，即使后续
数据校验、依赖检查或 CUDA 检查失败，也不会留下误导性的旧成功标记；
`--check-only` 则完全不触碰输出。训练开始时会写 `training-config.json`，其中记录实际参数以及数据和 manifest
哈希。只有训练结束、模型保存并被 `SentenceTransformer` 重新加载成功后，才会
写 `training-complete.json`。该 marker 是成功证明；仅有目录或 checkpoint 不
代表训练完成。

AutoDL 脚本在切换到仓库目录前将 `~`、相对和绝对输出路径统一规范化，并在
启动训练 Python 前创建且验证 `training.log` 可写。依赖预检包含 `accelerate`；
Python 或 `tee` 任一失败都会以非零状态退出。

训练脚本只允许模型下载产生的常规网络访问，不读取或记录 API Key。云端运行
后应保留 `training.log` 和模型目录，再用 `evaluate.py` 在固定测试集上生成真实
base/tuned 报告；无论是否提升都如实留档。

## 可选 Embeddings 服务

训练产物可以独立暴露为 OpenAI-compatible Embeddings 端点；这不会修改应用当前
默认 provider，也不包含自动切换逻辑。调用方仍应保留原有 embedding 服务作为
失败回退。

```bash
python tools/embedding/serve.py \
  --model-path tools/embedding/saves/bge-small-zh-trpg \
  --served-model-name bge-small-zh-trpg \
  --host 127.0.0.1 \
  --port 8001
```

也可以使用 `TRPG_EMBEDDING_MODEL_PATH`、`TRPG_EMBEDDING_SERVED_MODEL`、
`TRPG_EMBEDDING_HOST` 和 `TRPG_EMBEDDING_PORT` 环境变量。模型只在服务启动时
加载一次；编码工作在线程中执行，并用最小锁串行保护模型 `encode` 调用。加载或
推理失败时 `/v1/embeddings` 返回不含本地路径、异常堆栈和请求头的通用 503。

请求示例：

```json
{"model":"bge-small-zh-trpg","input":["铜钟停在几点？","钥匙有什么作用？"]}
```

服务固定返回自身配置的 `served-model-name`，不会采用调用者传入的名称伪装实际
模型。由于 SentenceTransformer 不提供 OpenAI token 计数，响应中的
`prompt_tokens` 与 `total_tokens` 均明确返回 0。
