# FastAPI AI 网关实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变 Electron 权威游戏内核的前提下，新增一个可运行、可测试、支持 SQLite/PostgreSQL 的 FastAPI + LangChain AI 网关，并修复现有 base/RAG Bench 的变量隔离问题。

**Architecture:** FastAPI 提供 OpenAI-compatible 聊天、直接检索和规则 Agent 接口；LangChain 负责模型链与工具循环，程序根据结构化工具证据生成权威规则判定。检索层只依赖 `Retriever` 协议，首版 JSON 索引在应用启动时一次性载入内存；SQLAlchemy 仅保存 API 会话和调用元数据。

**Tech Stack:** Python 3.11+、FastAPI、Pydantic、LangChain 1.x、langchain-openai、SQLAlchemy 2.x、psycopg 3、pytest、Docker Compose、Bun/TypeScript。

**Spec:** `docs/superpowers/specs/2026-09-13-fastapi-ai-gateway-design.md`

## Global Constraints

- Electron 的确定性事件内核和战役 SQLite 数据库继续作为唯一权威状态。
- LLM 只能选择工具和生成解释；骰点、合计值和成功/失败只能来自程序执行的结构化工具证据。
- FastAPI 数据库不得保存 Prompt、生成正文、API Key 或上游凭据。
- SQLite 是零配置默认值；PostgreSQL 只通过 `DATABASE_URL` 切换，不建立第二套业务代码。
- 首版只实现非流式响应；`stream=true` 必须明确拒绝。
- JSON 索引不得在每个请求中同步读盘；路由不得依赖具体索引实现。
- LoRA 实际训练、流式输出、任务队列和监控平台不在本计划范围内，README 不得写成已完成。
- 只暂存并提交每个任务明确列出的文件，保留工作区原有未提交内容。

---

### Task 1: 建立 Python 服务骨架与类型化配置

**Files:**
- Create: `services/ai-api/pyproject.toml`
- Create: `services/ai-api/app/__init__.py`
- Create: `services/ai-api/app/config.py`
- Create: `services/ai-api/tests/test_config.py`
- Create: `services/ai-api/.gitignore`

**Interfaces:**
- Consumes: 环境变量和可选 `.env` 文件。
- Produces: `Settings`、`get_settings()`，供存储、检索、Gateway 和 FastAPI 生命周期使用。

- [ ] **Step 1: 创建依赖清单与空包**

`pyproject.toml` 使用以下依赖边界：

```toml
[project]
name = "ai-trpg-gateway"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.116,<1",
  "uvicorn[standard]>=0.35,<1",
  "langchain>=1,<2",
  "langchain-openai>=1,<2",
  "sqlalchemy>=2,<3",
  "psycopg[binary]>=3.2,<4",
  "pydantic-settings>=2,<3",
]

[project.optional-dependencies]
test = ["pytest>=8,<9", "pytest-asyncio>=0.24,<2", "httpx>=0.28,<1"]

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-q"
```

`.gitignore` 仅忽略 `.venv/`、`__pycache__/`、`.pytest_cache/`、`data/` 和 `.env`。

- [ ] **Step 2: 安装服务测试依赖**

Run:

```powershell
cd services/ai-api
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[test]"
```

Expected: 安装完成，未读取或生成真实 API Key。

- [ ] **Step 3: 先写配置失败测试**

```python
from app.config import Settings


def test_settings_default_to_local_sqlite(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    settings = Settings(_env_file=None)
    assert settings.database_url == "sqlite:///./data/ai-api.db"
    assert settings.retriever_backend == "json"


def test_settings_accept_postgresql_url(monkeypatch):
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql+psycopg://trpg:trpg@localhost:5432/trpg",
    )
    settings = Settings(_env_file=None)
    assert settings.database_url.startswith("postgresql+psycopg://")
```

- [ ] **Step 4: 运行测试并确认 RED**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_config.py -q`

Expected: FAIL，原因是 `app.config` 或 `Settings` 尚不存在。

- [ ] **Step 5: 实现最小配置对象**

```python
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./data/ai-api.db"
    upstream_base_url: str = "http://127.0.0.1:11434/v1"
    upstream_api_key: str = "ollama"
    chat_model: str = "qwen2.5:3b-instruct"
    embedding_base_url: str = "http://127.0.0.1:11434/v1"
    embedding_api_key: str = "ollama"
    embedding_model: str = "bge-m3"
    retriever_backend: str = "json"
    rag_index_path: str = "../../electron/data/rag-index.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 6: 运行配置测试并确认 GREEN**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_config.py -q`

Expected: 2 passed。

- [ ] **Step 7: 提交本任务**

```powershell
git add -- services/ai-api/pyproject.toml services/ai-api/app/__init__.py services/ai-api/app/config.py services/ai-api/tests/test_config.py services/ai-api/.gitignore
git commit -m "feat(api): scaffold FastAPI gateway settings"
```

---

### Task 2: 实现跨语言一致的确定性规则证据

**Files:**
- Create: `services/ai-api/app/rules.py`
- Create: `services/ai-api/tests/test_rules.py`
- Test: `electron/src/core/engine/rng.ts`

**Interfaces:**
- Consumes: `seed`、`turn_id` 和经过边界校验的工具参数。
- Produces: `RollEvidence`、`RuleResolution`、`roll_for()`、`roll_notation()`、`skill_check()`、`canonical_rule_result()`。

- [ ] **Step 1: 写入固定测试向量和幻觉隔离测试**

```python
from app.rules import (
    RollEvidence,
    canonical_rule_result,
    roll_for,
    roll_notation,
    skill_check,
)


def test_roll_for_matches_typescript_vectors():
    assert roll_for("br-test", "t-3", 20) == 17
    assert roll_for("bench", "base-rule-0-0:check:3:12", 20) == 20
    assert roll_for("种子", "回合-一:1d100:0", 100) == 56
    assert roll_for("emoji-🎲", "turn-1", 6) == 2


def test_same_turn_replays_same_evidence():
    first = roll_notation("2d6+3", "seed", "turn-7")
    assert first == roll_notation("2d6+3", "seed", "turn-7")


def test_program_resolution_ignores_hallucinated_explanation():
    evidence = skill_check(3, 12, 20, "seed", "turn-7")
    result = canonical_rule_result([evidence], "我掷出了 999 点并自动成功")
    assert str(evidence.total) in result.resolution
    assert "999" not in result.resolution
    assert "999" not in result.explanation


def test_no_tool_evidence_means_no_ruling():
    result = canonical_rule_result([], "模型声称检定成功")
    assert result.status == "undecided"
    assert "成功" not in result.resolution
```

- [ ] **Step 2: 运行规则测试并确认 RED**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_rules.py -q`

Expected: FAIL，原因是 `app.rules` 尚不存在。

- [ ] **Step 3: 实现 JS UTF-16、FNV-1a 与 Mulberry32**

实现时必须按 UTF-16LE code unit 遍历字符串，以匹配 JavaScript `charCodeAt()`；不能直接遍历 Python Unicode code point。

```python
def _utf16_units(text: str):
    raw = text.encode("utf-16-le", "surrogatepass")
    for index in range(0, len(raw), 2):
        yield int.from_bytes(raw[index:index + 2], "little")


def hash_text(text: str) -> int:
    value = 2166136261
    for unit in _utf16_units(text):
        value ^= unit
        value = (value * 16777619) & 0xFFFFFFFF
    return value


def _mulberry32_once(seed: int) -> float:
    value = (seed + 0x6D2B79F5) & 0xFFFFFFFF
    first = ((value ^ (value >> 15)) * (1 | value)) & 0xFFFFFFFF
    product = ((first ^ (first >> 7)) * (61 | first)) & 0xFFFFFFFF
    mixed = ((first + product) & 0xFFFFFFFF) ^ first
    mixed ^= mixed >> 14
    return (mixed & 0xFFFFFFFF) / 4294967296


def roll_for(seed: str, turn_id: str, sides: int) -> int:
    return 1 + int(_mulberry32_once(hash_text(f"{seed}:{turn_id}")) * sides)
```

- [ ] **Step 4: 实现结构化证据与程序判定**

`RollEvidence` 必须包含 `tool`、`rolls`、`total`，并按工具类型包含 `notation/modifier` 或 `attribute/difficulty/sides/success`。`canonical_rule_result()` 只读取最后一条有效证据生成 `resolution`；说明文字包含证据集合以外的数字时，将其替换成程序模板说明。

```python
class RollEvidence(BaseModel):
    tool: Literal["roll_dice", "skill_check"]
    rolls: list[int]
    total: int
    notation: str | None = None
    modifier: int = 0
    attribute: int | None = None
    difficulty: int | None = None
    sides: int | None = None
    success: bool | None = None


class RuleResolution(BaseModel):
    status: Literal["resolved", "undecided"]
    resolution: str
    evidence: list[RollEvidence]
    explanation: str


def canonical_rule_result(evidence: list[RollEvidence], explanation: str) -> RuleResolution:
    if not evidence:
        return RuleResolution(
            status="undecided",
            resolution="未执行有效规则工具，无法判定。",
            evidence=[],
            explanation="请补充需要检定的属性与难度。",
        )
    item = evidence[-1]
    resolution = render_evidence(item)
    allowed = evidence_numbers(item)
    mentioned = {int(value) for value in re.findall(r"\d+", explanation)}
    safe_explanation = explanation if mentioned <= allowed else resolution
    return RuleResolution(
        status="resolved",
        resolution=resolution,
        evidence=evidence,
        explanation=safe_explanation,
    )
```

- [ ] **Step 5: 运行规则测试并确认 GREEN**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_rules.py -q`

Expected: 全部通过，包括 emoji 测试向量。

- [ ] **Step 6: 提交本任务**

```powershell
git add -- services/ai-api/app/rules.py services/ai-api/tests/test_rules.py
git commit -m "feat(api): add deterministic rule evidence"
```

---

### Task 3: 建立可替换 Retriever 与内存 JSON 索引

**Files:**
- Create: `services/ai-api/app/retrieval.py`
- Create: `services/ai-api/tests/test_retrieval.py`

**Interfaces:**
- Consumes: `Path` 和实现 `Embedder.aembed_query(text)` 的对象。
- Produces: `RetrievedDocument`、`Retriever`、`JsonVectorRetriever.load()`、`ready()`、`retrieve()`、`create_retriever(settings, embedder)`。

- [ ] **Step 1: 写入排序、单次加载和替换边界测试**

```python
import json
from pathlib import Path
import pytest
from app.retrieval import JsonVectorRetriever, Retriever


class FakeEmbedder:
    async def aembed_query(self, text: str) -> list[float]:
        return [1.0, 0.0] if "账本" in text else [0.0, 1.0]


@pytest.mark.asyncio
async def test_json_retriever_ranks_in_memory_index(tmp_path: Path):
    index = tmp_path / "rag-index.json"
    index.write_text(json.dumps({"dim": 2, "docs": [
        {"id": "book", "text": "黑色账本", "source": "facts", "vector": [1, 0]},
        {"id": "room", "text": "二楼书房", "source": "rooms", "vector": [0, 1]},
    ]}), encoding="utf-8")
    retriever = JsonVectorRetriever(index, FakeEmbedder())
    await retriever.load()
    index.unlink()
    hits = await retriever.retrieve("账本在哪里", 1)
    assert hits[0].id == "book"
    assert isinstance(retriever, Retriever)


@pytest.mark.asyncio
async def test_missing_index_is_not_ready(tmp_path: Path):
    retriever = JsonVectorRetriever(tmp_path / "missing.json", FakeEmbedder())
    await retriever.load()
    assert retriever.ready() is False
```

- [ ] **Step 2: 运行检索测试并确认 RED**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_retrieval.py -q`

Expected: FAIL，原因是 `app.retrieval` 尚不存在。

- [ ] **Step 3: 实现协议、启动加载和内存检索**

```python
@runtime_checkable
class Retriever(Protocol):
    async def retrieve(self, query: str, top_k: int) -> list[RetrievedDocument]: ...
    def ready(self) -> bool: ...


class JsonVectorRetriever:
    async def load(self) -> None:
        self._index = await asyncio.to_thread(self._read_index)

    async def retrieve(self, query: str, top_k: int) -> list[RetrievedDocument]:
        vector = await self._embedder.aembed_query(query)
        return rank_documents(self._index, vector, top_k)
```

`_read_index()` 失败时保存空快照；`retrieve()` 只访问快照，不打开文件。`create_retriever()` 首版只接受 `json`，其他值抛出包含 backend 名称的配置错误。

- [ ] **Step 4: 运行检索测试并确认 GREEN**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_retrieval.py -q`

Expected: 全部通过；删除源 JSON 后仍可检索，证明请求阶段没有读盘。

- [ ] **Step 5: 提交本任务**

```powershell
git add -- services/ai-api/app/retrieval.py services/ai-api/tests/test_retrieval.py
git commit -m "feat(api): add replaceable in-memory retriever"
```

---

### Task 4: 实现 SQLite/PostgreSQL 调用元数据存储

**Files:**
- Create: `services/ai-api/app/storage.py`
- Create: `services/ai-api/tests/test_storage.py`

**Interfaces:**
- Consumes: `Settings.database_url` 和 `CallRecord`。
- Produces: `Base`、`ApiSession`、`ApiCall`、`CallRecord`、`CallRecorder.init_schema()`、`record()`、`ping()`。

- [ ] **Step 1: 写入 SQLite 持久化与 PostgreSQL Dialect 测试**

```python
from sqlalchemy import inspect, select
from app.storage import ApiCall, CallRecord, CallRecorder


def test_sqlite_records_metadata_without_content(tmp_path):
    recorder = CallRecorder(f"sqlite:///{tmp_path / 'calls.db'}")
    recorder.init_schema()
    assert recorder.record(CallRecord(
        endpoint="/v1/chat/completions",
        model="fake-model",
        status="ok",
        latency_ms=12,
        prompt_tokens=4,
        completion_tokens=7,
    ))
    columns = {column["name"] for column in inspect(recorder.engine).get_columns("api_calls")}
    assert "prompt" not in columns
    assert "response" not in columns


def test_postgresql_url_selects_postgresql_driver():
    recorder = CallRecorder("postgresql+psycopg://trpg:trpg@localhost:5432/trpg")
    assert recorder.engine.dialect.name == "postgresql"
    recorder.engine.dispose()
```

- [ ] **Step 2: 运行存储测试并确认 RED**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_storage.py -q`

Expected: FAIL，原因是 `app.storage` 尚不存在。

- [ ] **Step 3: 实现两张表与单一 Recorder**

使用 SQLAlchemy 2 Declarative API。`api_sessions` 包含 `id/created_at/updated_at`；`api_calls` 包含 `id/session_id/endpoint/model/status/latency_ms/prompt_tokens/completion_tokens/created_at`。为 `session_id/status/created_at` 建索引。

SQLite Engine 添加 `connect_args={"check_same_thread": False}`；PostgreSQL 不添加 SQLite 参数。`record()` 捕获 SQLAlchemy 异常、回滚并返回 `False`，不得把输入或密钥写入错误信息。

```python
class Base(DeclarativeBase):
    pass


class ApiCall(Base):
    __tablename__ = "api_calls"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str | None] = mapped_column(String(36), index=True)
    endpoint: Mapped[str] = mapped_column(String(80))
    model: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20), index=True)
    latency_ms: Mapped[int] = mapped_column(Integer)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class CallRecorder:
    def __init__(self, database_url: str):
        kwargs = {"connect_args": {"check_same_thread": False}} if database_url.startswith("sqlite") else {}
        self.engine = create_engine(database_url, **kwargs)

    def init_schema(self) -> None:
        Base.metadata.create_all(self.engine)

    def record(self, item: CallRecord) -> bool:
        try:
            with Session(self.engine) as session:
                session.add(ApiCall.from_record(item))
                session.commit()
            return True
        except SQLAlchemyError:
            return False
```

- [ ] **Step 4: 运行存储测试并确认 GREEN**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_storage.py -q`

Expected: 全部通过；PostgreSQL 测试只构造 Engine，不发起网络连接。

- [ ] **Step 5: 提交本任务**

```powershell
git add -- services/ai-api/app/storage.py services/ai-api/tests/test_storage.py
git commit -m "feat(api): persist call metadata with SQLAlchemy"
```

---

### Task 5: 接入 LangChain 聊天、RAG 和 FastAPI 路由

**Files:**
- Create: `services/ai-api/app/gateway.py`
- Create: `services/ai-api/app/main.py`
- Create: `services/ai-api/tests/test_api.py`

**Interfaces:**
- Consumes: `Settings`、`Retriever`、`CallRecorder`、LangChain `BaseChatModel`。
- Produces: `ChatGateway.complete()`、`ChatGateway.retrieve()`、`create_app(settings, gateway, recorder)`、模块级 `app`。

- [ ] **Step 1: 写入 API 合同失败测试**

```python
from fastapi.testclient import TestClient
from app.config import Settings
from app.main import create_app


class FakeGateway:
    rag_ready = True

    async def retrieve(self, query: str, top_k: int):
        return [{"id": "book", "text": "黑色账本", "source": "facts", "score": 1.0}]

    async def complete(self, messages, model, temperature, use_rag):
        return {"text": "门后传来脚步声。", "model": model, "prompt_tokens": 3, "completion_tokens": 6}


def test_health_and_openai_compatible_chat(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'api.db'}", _env_file=None)
    client = TestClient(create_app(settings=settings, gateway=FakeGateway()))
    assert client.get("/health").json()["status"] == "ok"
    response = client.post("/v1/chat/completions", json={
        "model": "fake-model",
        "messages": [{"role": "user", "content": "推门"}],
        "rag": True,
    })
    assert response.status_code == 200
    assert response.json()["choices"][0]["message"]["role"] == "assistant"


def test_streaming_is_explicitly_rejected(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'api.db'}", _env_file=None)
    client = TestClient(create_app(settings=settings, gateway=FakeGateway()))
    response = client.post("/v1/chat/completions", json={
        "messages": [{"role": "user", "content": "推门"}],
        "stream": True,
    })
    assert response.status_code == 400
```

再补两条测试：`/v1/retrieve` 返回统一文档结构；FakeGateway 抛出上游异常时接口返回 503 且正文不包含上游 URL/API Key。

- [ ] **Step 2: 运行 API 测试并确认 RED**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_api.py -q`

Expected: FAIL，原因是 `app.main` 和 `create_app` 尚不存在。

- [ ] **Step 3: 实现 ChatGateway**

生产构造器使用 `ChatOpenAI(model=settings.chat_model, base_url=settings.upstream_base_url, api_key=settings.upstream_api_key)` 和 `OpenAIEmbeddings`。`complete()` 把输入转换为 LangChain messages；启用 RAG 时调用 `Retriever.retrieve()`，把命中内容放入明确标记的 system context，然后执行 `await model.ainvoke(messages)`。

不得在 Gateway 中打开 JSON 文件，也不得把上游密钥传入响应或 Recorder。

```python
class ChatGateway:
    def __init__(self, model: BaseChatModel, retriever: Retriever):
        self._model = model
        self._retriever = retriever

    @property
    def rag_ready(self) -> bool:
        return self._retriever.ready()

    async def complete(self, messages, model, temperature, use_rag):
        chain_messages = to_langchain_messages(messages)
        if use_rag and self._retriever.ready():
            query = latest_user_text(messages)
            hits = await self._retriever.retrieve(query, 3)
            chain_messages.insert(0, SystemMessage(content=render_rag_context(hits)))
        reply = await self._model.ainvoke(chain_messages)
        return completion_result(reply, model)

    async def retrieve(self, query: str, top_k: int):
        return await self._retriever.retrieve(query, top_k)
```

- [ ] **Step 4: 实现 FastAPI 工厂与生命周期**

`create_app()` 支持测试注入；未注入时创建真实 Retriever、ChatGateway 和 CallRecorder。lifespan 顺序为：创建数据目录、`recorder.init_schema()`、`await retriever.load()`，然后开始接收请求。

聊天成功或失败都记录 endpoint、model、status、latency 和 usage；调用 `record()` 时通过 `asyncio.to_thread()`，避免同步数据库写入占用事件循环。

```python
def create_app(
    settings: Settings | None = None,
    gateway: ChatGateway | None = None,
    recorder: CallRecorder | None = None,
) -> FastAPI:
    resolved = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.recorder = recorder or CallRecorder(resolved.database_url)
        await asyncio.to_thread(app.state.recorder.init_schema)
        app.state.gateway = gateway or await build_gateway(resolved)
        yield
        app.state.recorder.engine.dispose()

    return FastAPI(title="AI TRPG Gateway", version="0.1.0", lifespan=lifespan)
```

- [ ] **Step 5: 运行 API 测试并确认 GREEN**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_api.py -q`

Expected: 健康检查、聊天、检索、拒绝流式和 503 脱敏测试全部通过。

- [ ] **Step 6: 提交本任务**

```powershell
git add -- services/ai-api/app/gateway.py services/ai-api/app/main.py services/ai-api/tests/test_api.py
git commit -m "feat(api): expose LangChain chat and retrieval endpoints"
```

---

### Task 6: 接入有证据约束的 LangChain 规则 Agent

**Files:**
- Modify: `services/ai-api/app/gateway.py`
- Modify: `services/ai-api/app/main.py`
- Create: `services/ai-api/tests/test_agent.py`

**Interfaces:**
- Consumes: Task 2 的 `RollEvidence/canonical_rule_result()` 和请求中的 `action/seed/turn_id`。
- Produces: `ChatGateway.resolve_rules()` 与 `POST /v1/agent/rules`。

- [ ] **Step 1: 写入工具证据与接口失败测试**

```python
from app.rules import canonical_rule_result, skill_check


def test_agent_result_uses_executed_evidence_only():
    evidence = skill_check(3, 12, 20, "seed", "turn-1")
    result = canonical_rule_result([evidence], "模型说骰点是 999")
    assert result.status == "resolved"
    assert result.evidence == [evidence]
    assert "999" not in result.resolution
    assert "999" not in result.explanation
```

API 测试注入 FakeRuleGateway：有证据时断言响应分开包含 `resolution/evidence/explanation`；无证据时断言 `status=undecided` 且没有成功/失败判定。

- [ ] **Step 2: 运行 Agent 测试并确认 RED**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_agent.py -q`

Expected: FAIL，原因是规则路由或 `resolve_rules()` 尚不存在。

- [ ] **Step 3: 构造请求级 LangChain 工具**

在 `resolve_rules(action, seed, turn_id)` 内创建局部 `evidence: list[RollEvidence]`。两个 `@tool` 只暴露以下模型参数：

```python
@tool
def roll_dice(notation: str) -> dict:
    item = roll_notation(notation, seed, turn_id)
    evidence.append(item)
    return item.model_dump()


@tool
def run_skill_check(attribute: int, difficulty: int, sides: int = 20) -> dict:
    item = skill_check(attribute, difficulty, sides, seed, turn_id)
    evidence.append(item)
    return item.model_dump()
```

`seed` 和 `turn_id` 来自闭包，不得出现在工具 Schema 中。

- [ ] **Step 4: 执行 create_agent 并组装权威结果**

使用 `create_agent(model, tools=[roll_dice, run_skill_check], system_prompt=...)` 和 `await agent.ainvoke(...)`。读取最后一条 AIMessage 作为候选 explanation，但必须把局部 `evidence` 传给 `canonical_rule_result()`。没有证据时返回 undecided；LLM 文本永远不能直接成为 `resolution`。

```python
agent = create_agent(
    model=self._model,
    tools=[roll_dice, run_skill_check],
    system_prompt=RULE_AGENT_PROMPT,
)
state = await agent.ainvoke({"messages": [{"role": "user", "content": action}]})
last = state.get("messages", [])[-1] if state.get("messages") else None
explanation = last.content if isinstance(getattr(last, "content", None), str) else ""
return canonical_rule_result(evidence, explanation)
```

- [ ] **Step 5: 运行规则与 API 测试并确认 GREEN**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_rules.py tests/test_agent.py tests/test_api.py -q
```

Expected: 全部通过；规则测试不需要真实模型。

- [ ] **Step 6: 提交本任务**

```powershell
git add -- services/ai-api/app/gateway.py services/ai-api/app/main.py services/ai-api/tests/test_agent.py
git commit -m "feat(api): add evidence-backed LangChain rule agent"
```

---

### Task 7: 增加 PostgreSQL 容器与可选真实集成测试

**Files:**
- Create: `services/ai-api/.env.example`
- Create: `services/ai-api/Dockerfile`
- Create: `services/ai-api/compose.yml`
- Create: `services/ai-api/tests/test_postgres.py`

**Interfaces:**
- Consumes: `DATABASE_URL` 和 Task 4 的 `CallRecorder`。
- Produces: `docker compose up --build` 启动路径和可选 `TEST_DATABASE_URL` 集成测试。

- [ ] **Step 1: 先写 PostgreSQL 集成测试**

```python
import os
import pytest
from app.storage import CallRecord, CallRecorder


@pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="未提供测试 PostgreSQL")
def test_postgresql_round_trip():
    recorder = CallRecorder(os.environ["TEST_DATABASE_URL"])
    recorder.init_schema()
    assert recorder.ping()
    assert recorder.record(CallRecord(
        endpoint="/health",
        model="none",
        status="ok",
        latency_ms=1,
        prompt_tokens=0,
        completion_tokens=0,
    ))
```

- [ ] **Step 2: 运行测试并确认默认 SKIP，而非伪 PASS**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_postgres.py -q -rs`

Expected: 1 skipped，原因明确显示“未提供测试 PostgreSQL”。

- [ ] **Step 3: 写入容器配置**

`compose.yml` 包含 `api` 和 `postgres` 两个服务；PostgreSQL 使用 healthcheck，API 的 `DATABASE_URL` 指向 `postgresql+psycopg://trpg:trpg@postgres:5432/trpg`，并等待数据库健康。API 映射 `8000:8000`，PostgreSQL 只为本地调试映射 `5432:5432`。

`.env.example` 列出全部变量但只提供 `ollama` 占位密钥。Dockerfile 使用 Python 3.11 slim、非 root 用户，并以 `uvicorn app.main:app --host 0.0.0.0 --port 8000` 启动。

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: trpg
      POSTGRES_USER: trpg
      POSTGRES_PASSWORD: trpg
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U trpg -d trpg"]
      interval: 5s
      timeout: 3s
      retries: 10
    ports: ["5432:5432"]
  api:
    build: .
    environment:
      DATABASE_URL: postgresql+psycopg://trpg:trpg@postgres:5432/trpg
      UPSTREAM_BASE_URL: http://host.docker.internal:11434/v1
      UPSTREAM_API_KEY: ollama
    depends_on:
      postgres:
        condition: service_healthy
    ports: ["8000:8000"]
```

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY pyproject.toml README.md ./
COPY app ./app
RUN pip install --no-cache-dir . && useradd --create-home gateway
USER gateway
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 4: 验证 Compose 静态配置**

Run: `docker compose -f services/ai-api/compose.yml config`

Expected: exit 0；若本机没有 Docker，记录“未执行”，继续完成离线验证，不把 PostgreSQL 集成测试写成已通过。

- [ ] **Step 5: Docker 可用时执行真实 PostgreSQL 测试**

Run:

```powershell
docker compose -f services/ai-api/compose.yml up -d postgres
$env:TEST_DATABASE_URL='postgresql+psycopg://trpg:trpg@localhost:5432/trpg'
services/ai-api/.venv/Scripts/python.exe -m pytest services/ai-api/tests/test_postgres.py -q
docker compose -f services/ai-api/compose.yml down
```

Expected: 1 passed。只关闭本计划创建的 Compose 服务，不删除 volume。

- [ ] **Step 6: 提交本任务**

```powershell
git add -- services/ai-api/.env.example services/ai-api/Dockerfile services/ai-api/compose.yml services/ai-api/tests/test_postgres.py
git commit -m "feat(api): add optional PostgreSQL deployment"
```

---

### Task 8: 修复 base/RAG Bench 的生成隔离

**Files:**
- Create: `electron/scripts/bench-mode.ts`
- Create: `electron/scripts/bench-mode.test.ts`
- Modify: `electron/scripts/bench.ts:109-116`
- Modify: `electron/scripts/bench.ts:175-183`

**Interfaces:**
- Consumes: `mode`、已加载 index 和延迟创建 embedder 的工厂。
- Produces: `generationRetrieval(mode, index, createEmbedder)`。

- [ ] **Step 1: 写入失败回归测试**

```typescript
import { expect, test } from "bun:test";
import { generationRetrieval } from "./bench-mode";

test("base mode keeps index for metrics but does not inject it into generation", () => {
  let created = 0;
  const result = generationRetrieval("base", { docs: [] }, () => {
    created += 1;
    return async () => [];
  });
  expect(result).toEqual({});
  expect(created).toBe(0);
});

test.each(["rag", "lora"])("%s mode injects retrieval dependencies", (mode) => {
  const index = { docs: [] };
  const embed = async () => [];
  expect(generationRetrieval(mode, index, () => embed)).toEqual({ index, embed });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `bun --cwd electron test scripts/bench-mode.test.ts`

Expected: FAIL，原因是 `bench-mode.ts` 尚不存在。

- [ ] **Step 3: 实现最小模式选择函数**

```typescript
export function generationRetrieval<TIndex, TEmbed>(
  mode: string,
  index: TIndex | undefined,
  createEmbedder: () => TEmbed,
): { index?: TIndex; embed?: TEmbed } {
  if (mode === "base" || !index) return {};
  return { index, embed: createEmbedder() };
}
```

`bench.ts` 继续总是加载 index 用于 Recall@3，但调用 `narrateTurn()` 时展开 `...generationRetrieval(mode, index, scriptEmbedder)`，删除当前无条件传入的 `index/embed`。

- [ ] **Step 4: 运行 Bench 回归测试并确认 GREEN**

Run: `bun --cwd electron test scripts/bench-mode.test.ts`

Expected: 2 tests passed；base 不创建 embedder。

- [ ] **Step 5: 运行现有 AI 层局部测试与类型检查**

Run:

```powershell
bun --cwd electron test src/core/ai/lc scripts/bench-mode.test.ts
bun run --cwd electron typecheck
```

Expected: 局部测试 0 fail；`tsc -b --noEmit` exit 0。

- [ ] **Step 6: 提交本任务**

```powershell
git add -- electron/scripts/bench-mode.ts electron/scripts/bench-mode.test.ts electron/scripts/bench.ts
git commit -m "fix(ai): isolate base and RAG benchmark generation"
```

---

### Task 9: 完成中文服务文档和招聘入口

**Files:**
- Create: `services/ai-api/README.md`
- Modify: `README.md`
- Create: `services/ai-api/tests/test_docs.py`

**Interfaces:**
- Consumes: Tasks 1–8 的实际命令、接口和验证结果。
- Produces: 中文项目入口、服务运行手册和防止夸大状态的文档测试。

- [ ] **Step 1: 先写文档合同测试**

```python
from pathlib import Path


def test_root_readme_exposes_real_gateway_capabilities():
    text = Path("../../README.md").read_text(encoding="utf-8")
    for keyword in ["FastAPI", "LangChain", "RAG", "Agent", "PostgreSQL", "SQLite"]:
        assert keyword in text
    assert "LoRA 已完成" not in text
    assert "流式输出已完成" not in text


def test_service_readme_has_both_database_commands():
    text = Path("README.md").read_text(encoding="utf-8")
    assert "sqlite" in text.lower()
    assert "postgresql+psycopg" in text
    assert "/v1/chat/completions" in text
```

- [ ] **Step 2: 运行文档测试并确认 RED**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_docs.py -q`

Expected: FAIL，原因是服务 README 不存在或根 README 缺少网关能力说明。

- [ ] **Step 3: 编写服务 README**

必须包含：职责边界、SQLite 快速启动、PostgreSQL Compose 启动、环境变量表、四个 API 示例、非流式限制、Agent 证据结构、Retriever 替换点、离线测试命令和可选 PostgreSQL 测试命令。

```markdown
# AI TRPG FastAPI 网关

## 服务边界
## SQLite 快速启动
## PostgreSQL 与 Docker Compose
## 环境变量
## API 示例
### 健康检查
### RAG 检索
### OpenAI-compatible 聊天
### 规则 Agent
## 确定性与数据安全
## 测试
## 已知限制与后续扩展
```

- [ ] **Step 4: 改写根 README 首屏**

首屏顺序固定为：一句话产品定位、已有系统架构图、核心能力矩阵、运行 Windows/Electron、运行 FastAPI、验证命令、项目状态。删除不存在的 `PRD/` 目录说明。

项目状态必须明确写：LoRA 训练与新三档 Bench 尚未完成；流式输出、异步任务和生产监控是扩展方向。

```markdown
# AI TRPG Engine

本地优先、AI 主持、确定性内核的单人 TRPG 引擎。

## 系统架构
## 核心能力
## 运行 Windows / Electron 客户端
## 运行 FastAPI AI 网关
## SQLite 与 PostgreSQL
## 验证
## 当前状态与路线图
```

- [ ] **Step 5: 运行文档测试并确认 GREEN**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_docs.py -q`

Expected: 2 passed。

- [ ] **Step 6: 提交本任务**

```powershell
git add -- README.md services/ai-api/README.md services/ai-api/tests/test_docs.py
git commit -m "docs: present AI gateway for recruitment review"
```

---

### Task 10: 最小充分验收

**Files:**
- Verify only: `services/ai-api/`
- Verify only: `electron/src/core/ai/lc/`
- Verify only: `electron/scripts/bench-mode.test.ts`
- Verify only: `README.md`

**Interfaces:**
- Consumes: 前九个任务的全部交付物。
- Produces: 可复述的实际验证记录，不修改功能。

- [ ] **Step 1: 运行全部 Python 离线测试**

Run:

```powershell
cd services/ai-api
.\.venv\Scripts\python.exe -m pytest -q -rs
```

Expected: 除未提供 `TEST_DATABASE_URL` 时 PostgreSQL 测试明确 skipped 外，其余 0 fail。

- [ ] **Step 2: 运行 Electron 相关局部验证**

Run:

```powershell
bun --cwd electron test src/core/ai/lc scripts/bench-mode.test.ts
bun run --cwd electron typecheck
```

Expected: 0 fail；类型检查 exit 0。

- [ ] **Step 3: 启动 SQLite 服务并验证健康检查**

Run:

```powershell
cd services/ai-api
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

另一个终端请求 `http://127.0.0.1:8000/health`。

Expected: HTTP 200，`status=ok`、`database_ready=true`；索引存在时 `rag_ready=true`。

- [ ] **Step 4: 核对 Git 精确修改范围**

Run:

```powershell
git status --short
git log --oneline -10
```

Expected: 本计划文件均已提交；用户原有的 `docs/bench/`、`electron/data/` 或其他未提交内容仍保持原样，未被意外纳入提交。

- [ ] **Step 5: 记录真实验收状态**

最终报告必须分别列出：Python 测试通过数、TypeScript/Bun 测试通过数、typecheck 状态、SQLite 健康检查状态、Docker Compose 状态、PostgreSQL 真实测试是 passed 还是 skipped。不得用“全部通过”概括未实际执行的项目。
