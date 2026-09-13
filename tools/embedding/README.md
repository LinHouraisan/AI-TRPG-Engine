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

只校验配置、数据和来源证明（不加载模型）：

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

训练开始时会写 `training-config.json`，其中记录实际参数以及数据和 manifest
哈希。只有训练结束、模型保存并被 `SentenceTransformer` 重新加载成功后，才会
写 `training-complete.json`。该 marker 是成功证明；仅有目录或 checkpoint 不
代表训练完成。

训练脚本只允许模型下载产生的常规网络访问，不读取或记录 API Key。云端运行
后应保留 `training.log` 和模型目录，再用 `evaluate.py` 在固定测试集上生成真实
base/tuned 报告；无论是否提升都如实留档。
