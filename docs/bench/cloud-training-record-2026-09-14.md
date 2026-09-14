# 云端训练留档（2026-09-14）

## 环境与版本

- 设备：NVIDIA GeForce RTX 5090 32GB，计算能力 `sm_120`
- 系统：Ubuntu 22.04，Python 3.12.3
- 训练环境：PyTorch `2.8.0+cu128`，CUDA runtime 12.8
- 训练框架：LLaMA-Factory `0.9.6.dev0`
- AI TRPG Engine 提交：`c263e7d9ac4138a06c4f13a8b9ef1c00f9b9a31f`
- Personal Knowledge Base 提交：`d89fe61c40212429e6d4624019acb89e69524b13`
- 云端数据盘：120GB；收尾时约使用 15GB

## 真实完成项

### TRPG 主持人文风 LoRA

- 基座：Qwen/Qwen2.5-3B-Instruct（ModelScope 下载，本地缓存训练）
- 数据：train=357、validation=1、test=62；训练集含 16 条人工种子与 341 条模板合成样本
- 方法：SFT + LoRA，rank=16，alpha=32，target=`q_proj/v_proj`，3 epoch，global_step=69
- 结果：train_loss=2.4124，eval_loss=3.2369，训练约 88.6 秒
- 产物：约 79MB Adapter；约 5.8GB 合并模型
- 完整性：`trainer_state.json` 有 loss；Adapter 与合并模型文件均存在；合并使用 ModelScope 本地基座路径完成

### Obsidian 只读查询规划 LoRA

- 基座：Qwen/Qwen2.5-3B-Instruct（复用本地缓存）
- 数据：train=70、validation=8、test=4，固定 seed=8503
- 方法：SFT + LoRA，rank=16，alpha=32，target=`q_proj/v_proj`，3 epoch，global_step=15
- 结果：train_loss=2.6681，eval_loss=2.2472，训练约 17.0 秒
- 产物：约 79MB Adapter
- 完整性：PEFT 可解析 `adapter_config.json`；safetensors 可打开且包含有效张量；`.training-complete` 已生成
- 确定性边界：LoRA 只生成查询计划；可靠性仍由 JSON Schema 校验、工具白名单、只读执行和安全回退共同保障，不依赖 LLM 自觉

### TRPG 领域 Embedding 微调

- 基座：BAAI/bge-small-zh-v1.5（ModelScope 本地模型）
- 数据：train=90、validation=6、test=12，固定 seed=8503；manifest 与数据 SHA-256 校验通过
- 方法：Sentence Transformers + MultipleNegativesRankingLoss，batch=16，3 epoch，18 steps
- 结果：train_loss=0.05115，最终 eval_loss=0.05184，训练约 135.8 秒
- 产物：约 365MB，可被 SentenceTransformer 重新加载；`training-complete.json` 已生成
- 固定测试集纯 IR 指标：base 与 tuned 均为 Recall@3=1.0、MRR=1.0、nDCG@3=1.0（12 条样本）
- 同机平均单查询编码延迟：base 约 8.902ms，tuned 约 9.399ms；延迟不可跨硬件比较

## 诚实口径与后续工作

1. 本轮证明了数据构建、训练、权重校验、合并与评测的完整闭环；不能把训练 loss 直接解释为业务提升。
2. TRPG 文风验证集仅 1 条，Obsidian 测试集仅 4 条，Embedding 测试集仅 12 条，统计区分度有限。
3. Embedding 的 base/tuned 指标同时饱和，说明当前合成测试集太容易，不应宣称检索指标提升。后续需补真实改写查询、困难负样本和跨内容包测试。
4. 两个 LoRA 尚未完成固定推理端点上的 base/Adapter 生成对照，因此简历可写“完成 LoRA 微调与可审计训练闭环”，暂不写提升百分比。
5. JSON 向量索引只适合演示规模；保留存储接口边界，数据增长后可替换为 pgvector、FAISS 或 Qdrant，避免把实现写死。
6. 训练全程不需要也未记录 API Key。

## 故障处理记录

- RTX 5090 的 `sm_120` 已由 PyTorch 2.8.0+cu128 实测矩阵乘法验证。
- GitHub clone 超时：改用同一官方仓库 codeload 归档，并记录源码归档 SHA-256。
- torchaudio 2.11.0 与 torch 2.8.0+cu128 不匹配：固定为 torchaudio 2.8.0+cu128 后通过导入与 GPU capability 验证。
- `huggingface.co` 在该实例不可达：只切换模型下载源到 ModelScope，模型、数据和训练参数不变。
- 自定义合并脚本仍尝试访问 Hugging Face：显式传入 ModelScope 本地基座目录，离线完成合并。
- Embedding 首次命令误用 `--model-name`：参数解析阶段失败，未训练；改为仓库定义的 `--model` 后成功，失败日志保留。

## 云端证据位置

- 总日志与环境清单：`/root/autodl-tmp/training-run/`
- TRPG Adapter：`/root/autodl-tmp/projects/AI-TRPG-Engine/tools/lora/saves/qwen2.5-3b-lora-trpg/`
- TRPG 合并模型：`/root/autodl-tmp/models/trpg-style-merged/`
- Obsidian Adapter：`/root/autodl-tmp/projects/Personal_Knowledge_Base/training/query_planner/saves/qwen2.5-3b-query-planner/`
- Embedding 模型：`/root/autodl-tmp/models/bge-small-zh-trpg/`
- Embedding 对比报告：`/root/autodl-tmp/training-run/embedding-eval/`
- 81 个关键文件的哈希清单：`/root/autodl-tmp/training-run/artifact-manifest.sha256`
- 面试证据包：`/root/autodl-tmp/interview-evidence.tar.gz`（约 113MB，SHA-256 sidecar 同目录）

面试建议表述：在单卡 RTX 5090 上完成两个 Qwen2.5-3B LoRA 与一个 BGE 领域 Embedding 的可复现训练闭环，处理了新架构 GPU 兼容、依赖版本错配、国内模型源与离线合并问题，并对小样本合成评测的统计局限做了明确边界说明。
