# TRPG 领域 Embedding 微调 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从现有 TRPG 内容包自动合成检索训练集，对中文 Embedding 模型进行对比学习微调，并生成基座与微调模型的可复现检索报告。

**Architecture:** 数据生成器把房间、NPC、事实、物品、调查和规则条目标准化为检索文档，用确定性模板构造查询，并从基座检索候选中选困难负样本。训练和评测位于独立工具目录，微调模型通过最小 OpenAI-compatible Embeddings 服务接入现有可配置检索边界。

**Tech Stack:** Python 3.11、sentence-transformers、PyTorch、FastAPI、Pydantic、pytest、BAAI/bge-small-zh-v1.5

**Spec:** `docs/superpowers/specs/2026-09-13-domain-model-training-design.md`

## Global Constraints

- 该任务称为领域 Embedding 对比学习微调，不称为 LoRA。
- 训练收益只比较 `BAAI/bge-small-zh-v1.5` 微调前后，不与当前 `bge-m3` 横向冒充收益。
- 数据按内容包或实体分组切分，同一实体不得跨训练集和测试集。
- 合成样本必须记录 `source: synthetic-template`；困难负样本必须与正样本 ID 不同。
- 新模型服务通过配置选择，失败时保留现有 Embedding 服务。
- 权重、缓存、checkpoint 和密钥不提交仓库。

---

### Task 1: 标准化内容包并合成检索样本

**Files:**
- Create: `tools/embedding/build_dataset.py`
- Create: `tools/embedding/tests/test_build_dataset.py`
- Create: `tools/embedding/data/.gitkeep`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `electron/content/packs/*/*.json`
- Produces: `Document(id: str, pack: str, kind: str, title: str, text: str)`
- Produces: `build_dataset(packs_dir: Path, output_dir: Path, seed: int = 8503) -> dict[str, int]`
- Produces: `documents.jsonl`、`train.jsonl`、`validation.jsonl`、`test.jsonl`、`manifest.json`

- [ ] **Step 1: 编写失败测试**

```python
def test_dataset_has_positive_and_non_matching_negative(tmp_path: Path):
    write_pack(tmp_path, facts=[{"id": "fact.clock", "title": "铜钟停在十一点四十七分"}])
    stats = build_dataset(tmp_path, tmp_path / "out", seed=7)
    rows = read_jsonl(tmp_path / "out" / "train.jsonl")
    assert stats["documents"] == 1
    assert all(row["positive_id"] != row["negative_id"] for row in rows if row.get("negative_id"))
    assert all(row["source"] == "synthetic-template" for row in rows)
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `python -m pytest tools/embedding/tests/test_build_dataset.py -q`

Expected: FAIL，提示 `tools.embedding.build_dataset` 不存在。

- [ ] **Step 3: 实现标准化和模板生成**

```python
def split_name(group: str) -> str:
    bucket = int(hashlib.sha256(group.encode("utf-8")).hexdigest()[:8], 16) % 10
    return "test" if bucket == 0 else "validation" if bucket == 1 else "train"

def training_row(query: str, positive: Document, negative: Document | None) -> dict:
    return {
        "query": query.strip(),
        "positive": positive.text,
        "positive_id": positive.id,
        "negative": negative.text if negative else "",
        "negative_id": negative.id if negative else "",
        "group": f"{positive.pack}:{positive.id}",
        "source": "synthetic-template",
    }
```

模板覆盖“某人物知道什么”“某地点有什么异常”“某条线索意味着什么”“如何到达某地点”“某物品有什么作用”等表达。没有足够候选时允许先生成无显式负样本的记录，由训练批内负样本补足。

- [ ] **Step 4: 验证可重复性和分组隔离**

Run: `python -m pytest tools/embedding/tests/test_build_dataset.py -q`

Expected: PASS；固定 seed 生成哈希一致，`group` 不跨集合。

- [ ] **Step 5: 生成真实仓库数据并提交**

Run: `python tools/embedding/build_dataset.py --packs electron/content/packs --output tools/embedding/data`

Expected: `manifest.json` 记录各集合数量、内容包、seed 与 SHA-256。

```bash
git add .gitignore tools/embedding
git commit -m "feat(embedding): synthesize domain retrieval dataset"
```

### Task 2: 加入基座难负样本挖掘与检索评测

**Files:**
- Create: `tools/embedding/mine_negatives.py`
- Create: `tools/embedding/evaluate.py`
- Create: `tools/embedding/tests/test_metrics.py`

**Interfaces:**
- Consumes: `documents.jsonl` 和 split JSONL
- Produces: `mine_hard_negatives(rows: list[dict], ranked_ids: dict[str, list[str]]) -> list[dict]`
- Produces: `RetrievalMetrics(recall_at_3: float, mrr: float, ndcg_at_3: float)`

- [ ] **Step 1: 编写困难负样本与指标测试**

```python
def test_first_wrong_high_rank_is_selected():
    rows = [{"query": "钟几点", "positive_id": "fact.clock"}]
    mined = mine_hard_negatives(rows, {"钟几点": ["fact.other", "fact.clock"]})
    assert mined[0]["negative_id"] == "fact.other"

def test_metrics_for_rank_two_hit():
    metrics = score_rankings([["wrong", "gold"]], ["gold"], k=3)
    assert metrics.recall_at_3 == 1.0
    assert metrics.mrr == 0.5
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `python -m pytest tools/embedding/tests/test_metrics.py -q`

Expected: FAIL，提示目标函数不存在。

- [ ] **Step 3: 实现难负样本挖掘和纯 IR 指标**

用基座模型编码查询和文档，余弦排序后选择第一个非正样本作为困难负样本。评测不调用裁判 LLM，逐条保存排名、正确 ID 和耗时。

- [ ] **Step 4: 运行局部测试**

Run: `python -m pytest tools/embedding/tests/test_metrics.py -q`

Expected: PASS。

- [ ] **Step 5: 提交挖掘和评测工具**

```bash
git add tools/embedding
git commit -m "feat(embedding): mine negatives and score retrieval"
```

### Task 3: 对比学习训练与模型导出

**Files:**
- Create: `tools/embedding/train.py`
- Create: `tools/embedding/requirements.txt`
- Create: `tools/embedding/train_autodl.sh`
- Create: `tools/embedding/README.md`
- Create: `tools/embedding/tests/test_training_config.py`

**Interfaces:**
- Consumes: `train.jsonl` 和 `validation.jsonl`
- Produces: `tools/embedding/saves/bge-small-zh-trpg/`

- [ ] **Step 1: 编写训练参数测试**

```python
def test_default_config_is_small_single_gpu():
    config = TrainingConfig()
    assert config.model_name == "BAAI/bge-small-zh-v1.5"
    assert config.epochs == 3
    assert config.max_seq_length <= 512
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `python -m pytest tools/embedding/tests/test_training_config.py -q`

Expected: FAIL，提示 `TrainingConfig` 不存在。

- [ ] **Step 3: 实现最小训练脚本**

```python
model = SentenceTransformer(config.model_name)
loss = losses.MultipleNegativesRankingLoss(model)
trainer = SentenceTransformerTrainer(
    model=model,
    args=args,
    train_dataset=train_dataset,
    eval_dataset=validation_dataset,
    loss=loss,
)
trainer.train()
model.save_pretrained(config.output_dir)
```

训练参数固定保存到输出目录，使用 seed 8503、3 epoch、最大长度 512；批大小可由命令行降低以适配显存，但不改变数据切分。

- [ ] **Step 4: 做 CPU smoke test**

Run: `python tools/embedding/train.py --data tools/embedding/data --output .tmp/embedding-smoke --max-steps 1 --device cpu`

Expected: 完成一个 step 并能重新加载输出模型。

- [ ] **Step 5: 提交训练入口**

```bash
git add tools/embedding
git commit -m "feat(embedding): add contrastive training pipeline"
```

### Task 4: 增加 OpenAI-compatible Embeddings 服务

**Files:**
- Create: `tools/embedding/serve.py`
- Create: `tools/embedding/tests/test_serve.py`
- Modify: `tools/embedding/README.md`

**Interfaces:**
- Consumes: 本地 SentenceTransformer 模型目录
- Produces: `POST /v1/embeddings`，请求 `{model: str, input: str | list[str]}`
- Produces: OpenAI-compatible `{object: "list", data: [{index, object, embedding}], model, usage}`

- [ ] **Step 1: 编写 API 合约测试**

```python
def test_embeddings_contract(fake_model):
    response = client.post("/v1/embeddings", json={"model": "trpg", "input": ["铜钟", "车票"]})
    assert response.status_code == 200
    assert [item["index"] for item in response.json()["data"]] == [0, 1]
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `python -m pytest tools/embedding/tests/test_serve.py -q`

Expected: FAIL，提示服务模块不存在。

- [ ] **Step 3: 实现最小服务和空输入校验**

服务启动时加载一次模型；推理使用 `asyncio.to_thread` 避免阻塞事件循环；空输入返回 422，模型异常返回 503，不输出原始密钥或请求头。

- [ ] **Step 4: 运行 API 测试**

Run: `python -m pytest tools/embedding/tests/test_serve.py -q`

Expected: PASS。

- [ ] **Step 5: 提交推理服务**

```bash
git add tools/embedding
git commit -m "feat(embedding): serve tuned model over embeddings api"
```

### Task 5: 运行基座与微调模型对比

**Files:**
- Create: `docs/bench/report-embedding-base.json`
- Create: `docs/bench/report-embedding-base.md`
- Create after cloud run: `docs/bench/report-embedding-tuned.json`
- Create after cloud run: `docs/bench/report-embedding-tuned.md`

**Interfaces:**
- Consumes: Task 2 的固定测试集和 Task 3 的模型
- Produces: 带模型、数据哈希、seed、样本数、Recall@3、MRR、nDCG@3 和平均编码延迟的报告

- [ ] **Step 1: 运行基座评测**

Run: `python tools/embedding/evaluate.py --model BAAI/bge-small-zh-v1.5 --data tools/embedding/data/test.jsonl --docs tools/embedding/data/documents.jsonl --out docs/bench/report-embedding-base`

Expected: 同名 JSON 和 Markdown 报告生成。

- [ ] **Step 2: 云端训练后运行微调评测**

Run: `python tools/embedding/evaluate.py --model tools/embedding/saves/bge-small-zh-trpg --data tools/embedding/data/test.jsonl --docs tools/embedding/data/documents.jsonl --out docs/bench/report-embedding-tuned`

Expected: tuned 报告生成；无论是否提升都保留真实结果。

- [ ] **Step 3: 验证报告字段**

Run: `python -m pytest tools/embedding/tests -q`

Expected: PASS。

- [ ] **Step 4: 提交报告**

```bash
git add docs/bench/report-embedding-* tools/embedding
git commit -m "docs(embedding): record base and tuned retrieval results"
```
