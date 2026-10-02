# 项目当前状态

核对日期：2026-09-16。范围：代码、配置、训练留档及已有评测；本次整理没有重跑桌面完整试玩或真实模型推理。

## 2026-09-29 设计更新

新增 [V1.0 架构手册](ARCHITECTURE-V1.md)：Python 成为业务核心、Electron 作为界面，V1.0 移除作者制作与发布需求，加入本项目运行数据的标注、复核、版本化数据集和导出。

这是目标设计及路线图更新，尚未迁移业务代码。现有代码已有负面反馈、诊断、人工修订和 audit-case-v1 导出；优质/中性样本、独立标注修订、复核版本与冻结数据集仍属于新设计。以下 9 月 16 日核对记录保留其历史日期与证据边界。

## 先看哪里

- 产品流程与图稿：[交互流程](portfolio/product/README.md)
- 源码：electron/ 是桌面端，services/ai-api/ 是 Python AI 网关。
- 训练入口：tools/lora/、tools/embedding/。
- 已完成训练的证据：[2026-09-14 留档](../artifacts/training/2026-09-14/README.md)
- 历史设计：docs/00–05 及 superpowers 中的方案，不能全部视作已实现。
- 已知问题：[演示问题记录](demo/mist-harbor-known-issues.md)，继续保留。

## 能力与证据边界

| 事项 | 已有证据 | 尚未由本次核验的事项 |
| --- | --- | --- |
| 桌面端、规则内核、状态提交和恢复 | 源码、文档和已有 Demo 材料 | 当前环境完整试玩 |
| SQLite／PostgreSQL | 桌面 SQLite 保存设置与战役；网关默认 SQLite，Compose 配 PostgreSQL 17 | 当前运行实例实际使用哪种后端 |
| AI 网关 | FastAPI、LangChain、SQLAlchemy 与接口实现 | 线上部署、高可用及生产负载 |
| 文风 LoRA | 9 月 14 日训练、权重校验与合并留档 | 固定条件下基座与 Adapter 的生成收益 |
| 领域 Embedding | 已完成训练，12 条测试的基座与微调指标均满分 | 泛化提升；不能从饱和指标推导收益 |
| 新流程图 | 按现有架构整理，含恢复与存储边界 | 本人 ProcessOn 实操熟练度 |

## 数据库结构

- settings.sqlite：应用设置。
- 每个战役的 campaign.sqlite：权威状态与历史。
- 网关 api_sessions、api_calls：会话和模型调用元数据。
- 网关可通过 SQLAlchemy 连接配置选择 SQLite 或 PostgreSQL。不是同一份业务数据双写，不是主从同步。

## 评测怎么读

docs/bench/report-base.* 和 report-rag.* 是历史 27 条样本报告，保留失败与偏题结果。它们不能代表当前版本全面验收，也不能替代 LoRA 基座对照。
新增流程图不是运行时自动生成的链路追踪，实际模型调用由路由配置决定。

## 本次整理

- 新交付的图稿归入 docs/portfolio/product/。
- 渲染中间目录与重复训练 checkpoint 移到仓库外归档，最终权重、数据、日志、评测和配置保留。
- .codex_artifacts 的生成脚本保留；node_modules 链接、开发依赖、工作树与运行数据不动。
- 归档清单与恢复位置见 [整理记录](CLEANUP-2026-09-16.md)。
