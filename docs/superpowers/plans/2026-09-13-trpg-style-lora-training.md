# TRPG 主持人文风 LoRA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 `tools/lora` 工程上离线合成可追溯的 TRPG 主持人数据，完成 Qwen2.5-3B 文风 LoRA 训练，并记录 base/RAG/LoRA 的真实对比结果。

**Architecture:** 保留现有在线模型扩展模式，新增无需 API Key 的确定性离线合成模式，从内容包实体和事实组合场景、玩家行动、检定提示及行动钩子。训练继续使用现有 LLaMA-Factory 单卡链路，评测复用 Electron bench，并补充可复现的格式指标。

**Tech Stack:** Python 3.11、LLaMA-Factory、PEFT LoRA、Qwen2.5-3B-Instruct、Bun/TypeScript

**Spec:** `docs/superpowers/specs/2026-09-13-domain-model-training-design.md`

## Global Constraints

- 文风 LoRA 只优化叙述口吻、结构和节奏，不宣称提升逻辑推理或知识记忆。
- 离线数据必须标记 `synthetic-template`，固定 seed 后可重复生成。
- 数据按内容包和场景实体分组切分，防止近似模板跨训练集和测试集。
- 训练输出不得包含模型自编骰点、未经上下文支持的成功结论或模组秘密泄漏。
- 已有 20 条人工样例保留为种子，不被离线生成器覆盖丢失。
- 训练成绩必须来自实际报告，不预设提升幅度。

---

### Task 1: 增加无需 API 的离线文风数据合成

**Files:**
- Modify: `tools/lora/synth_lora_data.py`
- Create: `tools/lora/tests/test_synth_lora_data.py`
- Create: `tools/lora/data/seeds.jsonl`
- Modify: `tools/lora/README.md`

**Interfaces:**
- Consumes: `electron/content/packs/*/*.json` 和现有 20 条人工种子
- Produces: `synthesize_offline(lore_root: Path, total: int, seed: int) -> list[dict]`
- Produces: 每行包含 `instruction`、`input`、`output` 和 `meta` 的候选数据

- [ ] **Step 1: 把现有人工数据保存为明确种子文件并编写失败测试**

```python
def test_offline_generation_is_deterministic_and_complete():
    first = synthesize_offline(FIXTURE_PACKS, total=40, seed=8503)
    second = synthesize_offline(FIXTURE_PACKS, total=40, seed=8503)
    assert first == second
    assert len(first) == 40
    assert all(row["output"].endswith("你要怎么做？") for row in first)
    assert all(row["meta"]["source"] == "synthetic-template" for row in first)
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `python -m pytest tools/lora/tests/test_synth_lora_data.py -q`

Expected: FAIL，提示 `synthesize_offline` 不存在。

- [ ] **Step 3: 实现基于内容包的组合生成器**

```python
def build_output(scene: Scene, variant: int) -> str:
    opening = OPENINGS[variant % len(OPENINGS)].format(detail=scene.detail)
    clue = CLUE_TRANSITIONS[variant % len(CLUE_TRANSITIONS)].format(clue=scene.clue)
    check = CHECK_PROMPTS[variant % len(CHECK_PROMPTS)].format(skill=scene.skill)
    return f"{opening}{clue}{check}你要怎么做？"
```

生成器从公开事实、房间介绍、NPC 台词和物品描述提取已有信息；秘密事实只用于标记为 Keeper 可见的训练样本，不混入普通玩家视角。通过不同开场、感官描写、风险提示和行动钩子的组合生成 300–500 条数据，不调用外部模型。

- [ ] **Step 4: 增加内容约束校验**

拒绝以下样本：输出不足 60 字或超过 220 字、不以固定行动钩子结尾、含“你掷出了/检定成功/检定失败”等代替玩家掷骰表述、输入输出为空、输出重复。

- [ ] **Step 5: 运行测试并生成 400 条候选数据**

Run: `python -m pytest tools/lora/tests/test_synth_lora_data.py -q`

Expected: PASS。

Run: `python tools/lora/synth_lora_data.py --offline --total 400 --seed 8503 --lore electron/content/packs --out tools/lora/data`

Expected: 20 条人工种子仍保留，生成文件和 manifest 明确区分人工与模板合成来源。

- [ ] **Step 6: 提交离线数据生成能力**

```bash
git add tools/lora/synth_lora_data.py tools/lora/tests tools/lora/data tools/lora/README.md
git commit -m "feat(lora): synthesize trpg style data offline"
```

### Task 2: 数据分组切分和训练配置校验

**Files:**
- Create: `tools/lora/prepare_dataset.py`
- Create: `tools/lora/tests/test_prepare_dataset.py`
- Modify: `tools/lora/data/dataset_info.json`
- Modify: `tools/lora/lora_qwen3b.yaml`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: 候选 `train.jsonl` 和 `seeds.jsonl`
- Produces: `train.sft.jsonl`、`validation.sft.jsonl`、`test.prompts.jsonl`、`manifest.json`

- [ ] **Step 1: 编写分组无泄漏测试**

```python
def test_scene_group_stays_in_one_split(tmp_path: Path):
    split_dataset(FIXTURE_ROWS, tmp_path, seed=8503)
    groups = {name: groups_in(tmp_path / f"{name}.sft.jsonl") for name in ("train", "validation")}
    assert groups["train"].isdisjoint(groups["validation"])
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `python -m pytest tools/lora/tests/test_prepare_dataset.py -q`

Expected: FAIL，提示 `split_dataset` 不存在。

- [ ] **Step 3: 实现按 `pack + scene_id` 的稳定切分**

测试集保留 prompt、参考输出、来源和场景分组；训练文件去掉 `meta` 并保持 Alpaca 三字段。`dataset_info.json` 注册独立 train/validation 数据集，训练配置增加验证集但保持现有 rank、target modules 和输出目录。

- [ ] **Step 4: 验证配置和数据文件**

Run: `python -m pytest tools/lora/tests -q`

Expected: PASS，所有 SFT 行均包含非空 `instruction/input/output`。

- [ ] **Step 5: 提交训练数据准备**

```bash
git add .gitignore tools/lora
git commit -m "feat(lora): split and validate style training data"
```

### Task 3: 增加确定性文风指标

**Files:**
- Create: `tools/lora/evaluate_style.py`
- Create: `tools/lora/tests/test_evaluate_style.py`
- Modify: `tools/lora/README.md`

**Interfaces:**
- Consumes: `test.prompts.jsonl` 和 OpenAI-compatible 生成端点
- Produces: `StyleMetrics(second_person_rate, action_hook_rate, illegal_roll_rate, length_pass_rate)`
- Produces: `docs/bench/report-style-base.*` 和 `docs/bench/report-style-lora.*`

- [ ] **Step 1: 编写规则指标测试**

```python
def test_illegal_roll_is_detected():
    metrics = score_outputs(["你掷出了18点，检定成功。你要怎么做？"])
    assert metrics.illegal_roll_rate == 1.0
    assert metrics.action_hook_rate == 1.0
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `python -m pytest tools/lora/tests/test_evaluate_style.py -q`

Expected: FAIL，提示 `score_outputs` 不存在。

- [ ] **Step 3: 实现不依赖裁判模型的格式指标**

规则只检测第二人称词汇、固定行动钩子、非法代掷短语和目标长度。事实冲突与整体质量继续使用现有 `electron/scripts/bench.ts` 的固定温度裁判，不混入确定性指标。

- [ ] **Step 4: 运行测试**

Run: `python -m pytest tools/lora/tests -q`

Expected: PASS。

- [ ] **Step 5: 提交评测工具**

```bash
git add tools/lora
git commit -m "feat(lora): add deterministic style metrics"
```

### Task 4: 云端训练、合并和三档评测

**Files:**
- Modify: `tools/lora/train_autodl.sh`
- Create after run: `docs/bench/report-style-base.json`
- Create after run: `docs/bench/report-style-base.md`
- Create after run: `docs/bench/report-style-lora.json`
- Create after run: `docs/bench/report-style-lora.md`
- Modify after run: `tools/lora/README.md`

**Interfaces:**
- Consumes: Task 2 的训练集、验证集和 Task 3 的测试集
- Produces: LoRA Adapter、合并模型、训练日志及 base/RAG/LoRA 报告

- [ ] **Step 1: 本地做数据和配置检查**

Run: `python -m pytest tools/lora/tests -q`

Expected: PASS。

- [ ] **Step 2: 云端运行现有单卡脚本**

Run: `bash tools/lora/train_autodl.sh`

Expected: 独立 Adapter 和合并模型目录生成，训练日志记录 GPU、epoch、样本数和最终 loss。

- [ ] **Step 3: 在同一测试集运行 base、RAG、LoRA**

Run: `bun --cwd electron run bench -- --mode base`

Run: `bun --cwd electron run bench -- --mode rag`

Run: `bun --cwd electron run bench -- --mode lora`

Expected: 三档报告均生成，模型名和端点与实际运行一致。

- [ ] **Step 4: 运行确定性文风评测**

Run: `python tools/lora/evaluate_style.py --data tools/lora/data/test.prompts.jsonl --mode base --out docs/bench/report-style-base`

Run: `python tools/lora/evaluate_style.py --data tools/lora/data/test.prompts.jsonl --mode lora --out docs/bench/report-style-lora`

Expected: 报告包含四项规则指标和逐条原始输出。

- [ ] **Step 5: 记录真实结果并提交**

只把 Adapter 路径、训练环境和真实指标写入 README，不提交权重。

```bash
git add docs/bench tools/lora/README.md
git commit -m "docs(lora): record style finetuning results"
```
