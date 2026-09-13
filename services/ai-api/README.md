# AI TRPG FastAPI 网关

这是桌面客户端之外的 AI 工程化接入层，使用 FastAPI、LangChain 和 SQLAlchemy 提供统一接口。它负责模型调用、RAG 检索、规则工具编排和运行元数据记录；不负责保存或修改权威战役状态。

## 服务边界

- Electron 的确定性事件内核和 `campaign.sqlite` 是战役事实的唯一权威来源。
- LLM 可以选择规则工具并生成自然语言解释，不能直接决定骰点、合计值或成功/失败。
- 网关数据库只保存接口名、模型、状态、时延和 token 统计，不保存 Prompt、回复正文或凭据。
- 当前只支持非流式聊天；`stream=true` 会返回 HTTP 400。

## SQLite 快速启动

需要 Python 3.11+。以下命令适用于 Windows PowerShell：

```powershell
cd services/ai-api
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[test]"
Copy-Item .env.example .env
# 编辑 .env，使用新生成的 UPSTREAM_API_KEY
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

默认 `DATABASE_URL=sqlite:///./data/ai-api.db`，启动时会自动建表。没有上游聊天密钥时，服务仍能启动并提供健康检查；调用聊天或 Agent 前必须配置有效密钥。

## PostgreSQL 与 Docker Compose

代码只依赖 SQLAlchemy URL，不维护第二套存储逻辑。手动切换示例：

```dotenv
DATABASE_URL=postgresql+psycopg://trpg:trpg@localhost:5432/trpg
```

使用仓库提供的容器配置：

```powershell
$env:UPSTREAM_API_KEY="填入新生成的密钥"
docker compose -f services/ai-api/compose.yml up --build
```

Compose 会启动 PostgreSQL 17 和 API，API 在 `http://127.0.0.1:8000`。JSON 索引以只读卷挂载；本机 Ollama 通过 `host.docker.internal` 提供 embedding。

## 环境变量

| 变量 | 默认/示例 | 用途 |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:///./data/ai-api.db` | SQLAlchemy 数据库连接；可直接换成 PostgreSQL |
| `UPSTREAM_BASE_URL` | `https://api.deepseek.com` | OpenAI-compatible 聊天接口地址 |
| `UPSTREAM_API_KEY` | 空 | 上游聊天密钥，只从环境或本地 `.env` 读取 |
| `CHAT_MODEL` | `deepseek-v4-flash` | 聊天与 Agent 使用的模型 |
| `EMBEDDING_BASE_URL` | `http://127.0.0.1:11434/v1` | embedding 的 OpenAI-compatible 地址 |
| `EMBEDDING_API_KEY` | `ollama` | 本地 Ollama 占位值；远端服务应换成真实环境变量 |
| `EMBEDDING_MODEL` | `bge-m3` | 向量模型 |
| `RETRIEVER_BACKEND` | `json` | Retriever 实现选择点 |
| `RAG_INDEX_PATH` | `../../electron/data/rag-index.json` | JSON 向量索引路径 |

`.env` 已被 Git 忽略，`.env.example` 只包含占位值。曾经粘贴到聊天或截图中的密钥应立即撤销并重新生成。

## API 示例

### 健康检查

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

返回数据库和 RAG 索引的独立就绪状态：

```json
{"status":"ok","database_ready":true,"rag_ready":false}
```

`rag_ready=false` 只表示当前没有成功载入索引，不影响非 RAG 聊天。

### RAG 检索

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8000/v1/retrieve `
  -ContentType "application/json" `
  -Body '{"query":"黑色账本在哪里","top_k":3}'
```

文档统一返回 `id/text/source/score`，路由不依赖 JSON 的内部结构。

### OpenAI-compatible 聊天

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8000/v1/chat/completions `
  -ContentType "application/json" `
  -Body '{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"我推开书房门"}],"rag":true}'
```

响应包含常见的 `id/object/created/model/choices/usage` 字段。当前只支持非流式响应。

### 规则 Agent

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8000/v1/agent/rules `
  -ContentType "application/json" `
  -Body '{"action":"力量 3 对难度 12 进行检定","seed":"campaign-1","turn_id":"turn-7"}'
```

响应分为三部分：

- `resolution`：程序根据结构化证据生成的权威判定。
- `evidence`：实际执行过的工具、骰点、加值、合计、难度和结果。
- `explanation`：LLM 的可读解释；如果包含证据以外的数字或相反成败，会被权威判定文本替换。

如果 Agent 没有执行工具，接口返回 `status=undecided`，不会接受模型自行宣称的成功或失败。

## 确定性与幻觉约束

规则调用形成一条可复核链路：

1. 请求提供 `seed` 和 `turn_id`，二者只保留在服务器闭包中，不暴露给 LLM 的工具 Schema。
2. LLM 只能在 `roll_dice` 与 `run_skill_check` 中选择，并填写受校验的业务参数。
3. Python 使用与 Electron TypeScript 相同的 UTF-16 FNV-1a + Mulberry32 算法执行掷骰。
4. 程序收集 `RollEvidence`，再生成 `RuleResolution`；模型文本永远不能直接写入权威 `resolution`。

因此，同一个 seed/turn 的重试结果一致，换回合才会产生新骰点。固定向量测试覆盖中文和 emoji seed，防止跨语言实现悄悄漂移。

## JSON 索引与替换点

首版 JSON 索引是演示友好的实现，不适合无限扩容。它在应用启动时通过工作线程一次性读入内存，请求阶段只做 embedding 和内存余弦排序，不会每次同步打开文件，因此不会把文件 I/O 阻塞写死在路由里。

路由只依赖 `Retriever` 协议：

```python
class Retriever(Protocol):
    async def retrieve(self, query: str, top_k: int) -> list[RetrievedDocument]: ...
    def ready(self) -> bool: ...
```

后续迁移到 pgvector、Milvus 或托管向量库时，只需新增实现并在 `create_retriever()` 注册；FastAPI 路由、聊天链和调用方合同不变。

## 测试

离线测试不访问真实模型：

```powershell
cd services/ai-api
.\.venv\Scripts\python.exe -m pytest -q -rs
```

可选 PostgreSQL 真实往返测试：

```powershell
$env:TEST_DATABASE_URL="postgresql+psycopg://trpg:trpg@localhost:5432/trpg"
.\.venv\Scripts\python.exe -m pytest tests/test_postgres.py -q
```

没有 `TEST_DATABASE_URL` 时该测试会明确显示 skipped，不会伪装成已验证。

## 已知限制与后续扩展

- LoRA 数据、训练、合并与本地部署位于 `tools/lora/`；网关只消费 OpenAI-compatible 模型端点，不承担 GPU 训练任务。
- 当前不支持流式输出、异步任务队列和生产级监控告警。
- JSON 向量索引适合演示和小数据；数据规模上升后应迁移到专用向量存储。
- PostgreSQL 配置和测试入口已提供，但是否通过真实集成测试必须以本机/CI 的实际测试记录为准。
