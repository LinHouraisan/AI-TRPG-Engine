# FastAPI AI 网关改造设计

## 1. 改造目标

在现有 AI TRPG Engine 仓库中增加一个小型、可独立运行的 Python AI 网关。网关需要提供真实、可运行、面试时可解释的 FastAPI、LangChain、RAG、Agent、REST API、SQLAlchemy、PostgreSQL、SQLite 和容器化部署能力，同时不替换 Electron 应用现有的权威游戏内核。

近期目标是让招聘方能够快速看懂项目的 AI 应用工程能力。LoRA 实际训练结果和扩展评测仍是后续工作，文档与简历不得把它们描述成已经完成。

## 2. 核心原则

- **游戏事实只有一个权威来源**：Electron 的确定性事件内核和战役 SQLite 数据库保持不变。
- **模型只提议，不裁定**：LLM 可以选择工具和生成解释，但不能直接决定骰点、成功或失败。
- **数据库职责分离**：FastAPI 数据库只记录 API 会话和调用元数据，不保存战役权威状态。
- **先实现最小闭环**：首版完成非流式 API、JSON 向量检索和双数据库适配，不提前建设队列、监控或分布式架构。
- **为替换留接口，不预先实现多套方案**：JSON 索引通过统一检索接口接入，后续可以更换 pgvector、FAISS 或 Qdrant，而不修改路由和业务链。

## 3. 实施范围

### 3.1 本次实现

- 在 `services/ai-api/` 新增独立 FastAPI 服务。
- 提供兼容 OpenAI 数据结构的非流式聊天接口。
- 提供直接检索接口，首版读取现有 `electron/data/rag-index.json`。
- 提供 LangChain 规则 Agent，并通过程序级约束保证骰点和判定可重放、不可由模型篡改。
- 使用 SQLAlchemy 保存 API 会话和调用元数据。
- 默认使用零配置 SQLite，通过 `DATABASE_URL` 切换到 PostgreSQL。
- 提供 Docker 方式启动 API 与 PostgreSQL。
- 修复并测试当前 base/RAG Bench 的变量隔离问题。
- 更新根 README 和服务 README，明确区分已完成能力与后续计划。

### 3.2 本次不实现

- 不把 Electron 战役数据从 SQLite 迁移到 PostgreSQL。
- 不允许模型直接写入游戏事实。
- 不实现流式输出和 SSE。
- 不实现任务队列、分布式 Worker、认证系统、完整监控平台或生产级编排。
- 不宣称 LoRA 已训练完成，也不宣称新的 base/RAG/LoRA 三档评测已经完成。
- 不在首版同时实现 pgvector、FAISS 或 Qdrant，只保留清晰的替换接口。

## 4. 总体架构

```text
Electron 或其他 API 调用方
        |
        v
FastAPI AI 网关
  |-- GET  /health
  |-- POST /v1/retrieve
  |-- POST /v1/chat/completions
  `-- POST /v1/agent/rules
        |
        |-- LangChain ChatOpenAI -> Ollama 或 OpenAI-compatible 上游模型
        |-- LangChain Embeddings -> Retriever 检索接口
        |                              `-- 首版：内存中的 JSON 向量索引
        `-- SQLAlchemy -> SQLite 或 PostgreSQL
```

FastAPI 网关是可选的 AI 服务边界。Electron 继续使用现有确定性事件内核和战役 SQLite 数据库；Electron 已有的 `openai_compatible` Provider 可以把网关地址配置为模型服务地址，不需要再增加一套 Electron 专用协议。

RAG 命中内容只作为有边界标记的 Prompt 上下文，不写入记忆、不生成领域事件、不修改权威状态。规则 Agent 可以判断是否需要调用工具，但最终判定只能来自程序实际执行过的工具结果。

## 5. 代码模块

Python 服务保持少量、职责清晰的模块：

- `app/config.py`：读取环境变量，生成数据库、模型、Embedding 和检索配置。
- `app/storage.py`：SQLAlchemy 模型、Engine/Session 构造、建表和调用元数据写入。
- `app/retrieval.py`：统一 `Retriever` 接口、检索结果类型和首版 `JsonVectorRetriever`。
- `app/gateway.py`：LangChain 聊天链、规则工具、Agent 执行和权威判定组装。
- `app/main.py`：FastAPI 应用、请求响应模型、依赖注入、生命周期和错误映射。

辅助文件包括 `pyproject.toml`、`.env.example`、`Dockerfile`、`compose.yml`、服务 README 和局部测试。

## 6. API 设计

### 6.1 `GET /health`

返回服务状态，并分别报告数据库和 RAG 是否可用。RAG 索引缺失不会使整个服务停止，因为 base 聊天仍可运行。

### 6.2 `POST /v1/retrieve`

接收非空 `query` 和有上限的 `top_k`，返回命中文档的 ID、文本、来源和余弦相似度。索引或 Embedding 服务不可用时，返回明确的服务暂不可用响应。

### 6.3 `POST /v1/chat/completions`

接收 OpenAI Chat Completions 的核心字段：`model`、`messages`、可选 `temperature` 和 `stream`，另外接受可选的 `rag` 布尔值。首版明确拒绝 `stream=true`，不假装支持流式输出。

开启 RAG 且检索器可用时，网关对最后一条用户消息进行向量化和检索，把结果注入有明确分隔符的上下文区。关闭 RAG 或索引缺失时，自动使用 base 聊天链。响应包含 OpenAI-compatible 的 ID、对象类型、时间戳、模型、一条助手消息和上游可提供的 token usage。

### 6.4 `POST /v1/agent/rules`

接收 `action`、`seed` 和 `turn_id`。LangChain Agent 负责理解行动并选择规则工具，FastAPI 程序负责执行工具、收集证据并生成权威判定。接口分别返回：

- `resolution`：程序根据工具结果生成的权威判定；
- `evidence`：实际执行过的工具、参数、骰点、合计值和结果；
- `explanation`：LLM 生成的非权威说明文字。

没有有效工具调用时，接口返回“需要澄清/未判定”，不能使用模型自行编出的数值作为结果。

## 7. LangChain Agent 的确定性与幻觉防护

仅在 Prompt 中写“不要编造点数”不能形成可靠保证。本设计采用四层程序约束。

### 7.1 请求上下文不交给模型修改

`seed` 和 `turn_id` 先由 FastAPI/Pydantic 校验，再通过闭包或 LangChain Runtime 注入工具。它们不出现在 LLM 可以填写的工具参数 Schema 中，模型只能提供骰子表达式、属性值、难度和骰面数，不能替换随机种子或回合 ID。

### 7.2 工具返回结构化证据

首版提供两个 `@tool` 工具：

- `roll_dice(notation)`：解析 `2d6+3` 等表达式并返回每次骰点、修正值和总点数。
- `skill_check(attribute, difficulty, sides=20)`：返回骰点、属性加值、总点数、难度和成功/失败。

工具不返回只有模型才能解释的自然语言，而是返回结构化 `RollEvidence`。骰子数量限制为 1–20，骰面限制为 2–1000；非法参数直接产生工具错误，不能进入权威结果。

### 7.3 随机算法与现有内核对齐

Python 侧实现与 `electron/src/core/engine/rng.ts` 相同的 FNV-1a 32 位 Hash 和 Mulberry32 算法，并使用相同的 key 组合规则。相同 `seed + turn_id + 工具参数` 必须产生相同骰点；只有新的 `turn_id` 才表示一次新掷骰。

跨语言测试使用固定测试向量，验证 TypeScript 与 Python 对同一输入得到同一结果，防止两套实现随时间漂移。

### 7.4 权威结果由程序生成

LangChain `create_agent` 负责模型与工具的调用循环，但服务会检查实际产生的 ToolMessage/工具执行记录：

1. 没有有效工具证据时，不产生成功/失败判定。
2. `resolution` 的骰点、总数和成功/失败只从 `RollEvidence` 复制，由程序模板生成。
3. LLM 最终消息只进入 `explanation`，即使它编造了另一个点数，也不能覆盖 `resolution`。
4. 若 explanation 中出现与证据冲突的判定数字，服务丢弃 explanation 或替换为程序生成的安全说明。

因此，Agent 的“智能”用于选择工具和解释结果，确定性与正确性由程序证据保证。

### 7.5 必测场景

- 相同 seed、turn ID 和参数重复调用，证据完全一致。
- 更换 turn ID 后才产生新的确定性骰点。
- 模型在最终文本中编造不同点数，不能改变 `resolution`。
- 模型未调用工具，不得返回成功或失败。
- 模型尝试传入非法骰子表达式或越界参数时，返回未判定错误。
- Python 与 TypeScript 固定测试向量一致。

## 8. 可替换的检索层与 JSON 索引性能

### 8.1 统一接口

路由和聊天链只依赖 `Retriever`，不直接读取 JSON 文件：

```python
class Retriever(Protocol):
    async def retrieve(self, query: str, top_k: int) -> list[RetrievedDocument]: ...
    def ready(self) -> bool: ...
```

`RetrievedDocument` 统一包含 `id`、`text`、`source` 和 `score`。`app/config.py` 提供 `RETRIEVER_BACKEND=json` 和 `RAG_INDEX_PATH`，工厂负责构造当前实现。路径、文件格式和余弦计算都不会写死在 FastAPI 路由中。

### 8.2 首版 JSON 实现

`JsonVectorRetriever` 在 FastAPI lifespan 启动阶段读取并校验一次索引，然后保存为只读内存快照。请求处理阶段不再同步读取磁盘，只执行 query embedding 和内存余弦排序，从而避免每个请求产生文件 I/O 阻塞。

首版的暴力余弦检索复杂度为 `O(N × d)`，适合当前演示规模。索引加载失败时保留空快照并在 `/health` 中报告 `rag_ready=false`，base 聊天仍可用。

首版不实现热更新。若以后增加索引重载，文件读取和解析需要在线程池中完成，验证成功后再原子替换内存快照，不能在请求协程中直接进行同步 I/O。

### 8.3 后续替换路径

当数据规模或并发量增长时，可以新增 `PgVectorRetriever`、`FaissRetriever` 或 `QdrantRetriever`，并通过 `RETRIEVER_BACKEND` 切换。替换时保持 `Retriever` 返回类型不变，因此 `/v1/retrieve`、聊天链和测试用例无需改写。

设计只保留替换边界，不在演示阶段提前实现三套向量数据库。

## 9. 数据库设计

`DATABASE_URL` 选择 SQLAlchemy 后端：

- 默认：服务数据目录中的本地 SQLite。
- 可选：`postgresql+psycopg://...` 对应 PostgreSQL。

网关建立两张表：

- `api_sessions`：会话 ID、创建时间和更新时间。
- `api_calls`：调用 ID、可选会话 ID、endpoint、model、status、latency、token usage 和创建时间。

为 session ID、status 和创建时间建立索引。默认不保存 Prompt、生成正文、上游凭据或 API Key。该数据库只保存运行元数据，永远不成为 Electron 战役状态的权威来源。

## 10. 配置与部署

服务仅从环境变量读取配置：

- `DATABASE_URL`
- `UPSTREAM_BASE_URL`、`UPSTREAM_API_KEY`、`CHAT_MODEL`
- `EMBEDDING_BASE_URL`、`EMBEDDING_API_KEY`、`EMBEDDING_MODEL`
- `RETRIEVER_BACKEND`、`RAG_INDEX_PATH`

默认开发方式使用 SQLite 和本地 Ollama-compatible 服务。Docker 配置提供 API 与 PostgreSQL 的组合启动方式。密钥只存在于环境变量中，不进入日志、响应和数据库记录。

## 11. 错误处理

- 请求字段不合法时使用 FastAPI/Pydantic 标准验证响应。
- `stream=true` 返回明确的客户端错误。
- 上游聊天或 Embedding 失败时返回 `503 Service Unavailable`，不暴露密钥和原始上游响应正文。
- RAG 数据缺失时，聊天退化为 base；`/health` 显示 `rag_ready=false`，直接检索接口返回明确的不可用响应。
- 数据库记录失败不应把一个已经成功的模型响应改成失败，但必须反映在服务诊断状态中。
- Agent 没有有效工具证据、参数越界或证据冲突时返回未判定，不允许模型文本兜底为权威结果。

## 12. Bench 对照修复

当前未提交的 Bench 为了计算所有档位的 Recall@3 总是加载向量索引，但 `mode=base` 的生成请求也收到了该索引，导致 base 与 RAG 对照失效。

模式选择将提取为小型纯函数并先写回归测试。索引可以继续用于独立计算检索指标，但只有 `rag` 和 `lora` 模式的生成链能够收到 Retriever/Embedding 依赖。修复并重新运行前，现有数字不会进入根 README 或简历。

## 13. 测试方案

默认测试不连接真实模型，也不需要 API Key，而是通过依赖注入使用 fake chat model 和 fake embedder。

- API 测试：健康检查、参数校验、非流式响应结构、RAG 降级、检索结果和上游错误映射。
- Agent 测试：工具真实执行记录、模型幻觉隔离、无工具不判定、参数越界和跨语言固定测试向量。
- 检索测试：启动时只加载一次 JSON、请求时不读盘、余弦排序、空索引降级和 Retriever 替换不影响路由。
- 存储测试：使用真实 SQLite 建表，验证只写元数据、不写 Prompt 正文。
- PostgreSQL 测试：本地验证 URL 和 Driver 选择；提供测试数据库 URL 时运行真实集成测试。本机没有可用 Docker/PostgreSQL 时必须明确标注未执行，不能虚报通过。
- Electron 测试：新增 base 模式不注入 RAG 的 TypeScript 回归测试，并保留现有 AI 层局部测试和 TypeScript typecheck。

## 14. 招聘展示与文档

根 README 首屏展示可运行产品、系统架构、已有图片和核心能力矩阵，并提供 FastAPI 启动命令、SQLite/PostgreSQL 切换方式、API 示例以及网关与 Electron 的关系。

对项目状态使用三类明确措辞：

- **已经完成**：FastAPI 网关、LangChain 聊天/RAG/Agent、REST API、SQLite/PostgreSQL 后端切换、Docker 配置和 Windows 客户端。
- **待补实验**：LoRA 实际训练结果，以及修复后重新生成的 base/RAG/LoRA 对比。
- **扩展接口**：流式输出、异步任务和生产监控。

扩展接口只能写成后续方向，不能写成已实现功能。

## 15. 验收标准

- 按文档命令使用 SQLite 启动服务，`/health` 返回成功。
- 只修改 `DATABASE_URL` 即可切换 PostgreSQL。
- 非流式聊天、直接检索和规则 Agent 均有可执行实现及离线测试。
- 规则 Agent 的权威结果只能由真实工具证据生成；模型幻觉不能修改点数或判定。
- Python 与 TypeScript 对固定 seed/turn ID 测试向量产生一致骰点。
- JSON 索引只在服务启动时读取一次；路由只依赖 Retriever 接口。
- Electron 能通过现有 OpenAI-compatible Provider 指向 FastAPI 网关。
- base 模式不能获得 RAG 生成依赖，并由回归测试保证。
- Python 局部测试、Electron AI 层局部测试和 TypeScript typecheck 通过。
- 文档不宣称 LoRA 结果、流式输出、任务队列或监控平台已经完成。

## 16. 技术依据

- LangChain 1.x 使用 `create_agent` 构建 Agent 工具循环，并支持以 Python 函数或 `@tool` 注册类型化工具。
- LangChain 工具可以返回结构化对象；模型能读取工具结果，但工具返回不会自动成为程序权威状态，因此本项目仍需在 Agent 外层校验 ToolMessage 并构造 `resolution`。
- 需要更细粒度控制时可改用 LangGraph `ToolNode`，但首版先使用 `create_agent` 加程序级证据校验，避免过度设计。
