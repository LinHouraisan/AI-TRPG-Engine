# FastAPI AI Gateway Design

## 1. Goal

Add a small, independently runnable Python AI gateway to the existing AI TRPG Engine repository. The gateway must provide real, explainable evidence for FastAPI, LangChain, RAG, Agent, REST API, SQLAlchemy, PostgreSQL, SQLite, and containerized deployment without replacing the Electron application's authoritative game-state kernel.

The immediate deliverable is a truthful recruitment-facing project surface. LoRA training results and expanded benchmarks remain follow-up work and must not be represented as complete.

## 2. Scope

### In scope

- A standalone FastAPI service under `services/ai-api/`.
- A non-streaming OpenAI-compatible chat-completions endpoint.
- A direct retrieval endpoint backed by the existing `electron/data/rag-index.json` format.
- A LangChain rule Agent whose dice results come only from deterministic tools.
- SQLAlchemy persistence for API sessions and call metadata.
- SQLite as the zero-configuration default and PostgreSQL selected through `DATABASE_URL`.
- Docker assets for running the API with PostgreSQL.
- A regression-tested repair of the base-versus-RAG benchmark mode selection.
- Recruitment-oriented root and service documentation that distinguishes completed work from planned extensions.

### Out of scope

- Migrating Electron campaign state from SQLite to PostgreSQL.
- Giving the model authority to mutate game facts.
- Streaming/SSE responses.
- Queues, distributed workers, authentication, metrics infrastructure, or production orchestration.
- Claiming that LoRA training or a new three-way benchmark has completed.

## 3. Architecture

```text
Electron or another API client
        |
        v
FastAPI AI Gateway
  |-- GET  /health
  |-- POST /v1/retrieve
  |-- POST /v1/chat/completions
  `-- POST /v1/agent/rules
        |
        |-- LangChain ChatOpenAI -> Ollama or OpenAI-compatible upstream
        |-- LangChain embeddings -> existing JSON vector index
        `-- SQLAlchemy -> SQLite or PostgreSQL
```

The gateway is an optional AI-service boundary. Electron retains its current deterministic event kernel and campaign SQLite database. Its existing `openai_compatible` provider can point at the gateway's base URL without introducing a second Electron-specific transport.

RAG results are prompt context only. They do not write memory, produce domain events, or change authoritative state. The rule Agent may decide whether to call a tool, but it cannot invent dice results: deterministic tools derive results from the request seed and turn ID.

## 4. Components

The Python package uses a small number of focused modules:

- `app/config.py`: environment-backed settings and database/upstream URLs.
- `app/storage.py`: SQLAlchemy models, engine/session construction, schema initialization, and metadata writes.
- `app/gateway.py`: LangChain chat chain, embeddings, JSON-index retrieval, and deterministic rule tools/Agent.
- `app/main.py`: FastAPI application, request/response schemas, dependency wiring, endpoint error mapping, and lifecycle setup.

Supporting files include `pyproject.toml`, `.env.example`, `Dockerfile`, `compose.yml`, a service README, and focused tests.

## 5. API Contracts

### `GET /health`

Returns service readiness plus separate database and RAG readiness fields. A missing RAG index does not make the whole service unhealthy, because base chat remains available.

### `POST /v1/retrieve`

Accepts a non-empty `query` and bounded `top_k`. Returns matched document ID, text, source, and cosine score. If the index or embedding service is unavailable, the endpoint returns a clear service-unavailable response.

### `POST /v1/chat/completions`

Accepts the core OpenAI chat-completions fields: `model`, `messages`, optional `temperature`, and `stream`. It also accepts an optional `rag` boolean. `stream=true` is rejected explicitly in the first version.

When RAG is enabled and ready, the gateway embeds the latest user message, retrieves relevant documents, and injects them into a delimited context section. When RAG is disabled or the index is absent, the request uses the base chat chain. The response contains an OpenAI-compatible ID, object type, timestamp, model, one assistant choice, and usage fields when supplied by the upstream model.

### `POST /v1/agent/rules`

Accepts `action`, `seed`, and `turn_id`. A LangChain Agent receives deterministic dice/check tools. Tool output and the final answer are returned without mutating campaign state.

## 6. Persistence

`DATABASE_URL` selects the SQLAlchemy backend:

- Default: a local SQLite database inside the service data directory.
- Optional: `postgresql+psycopg://...` for PostgreSQL.

The gateway creates two tables:

- `api_sessions`: session ID and creation/update timestamps.
- `api_calls`: call ID, optional session ID, endpoint, model, status, latency, token usage, and timestamp.

Indexes cover session ID, status, and creation time. Prompt text, generated content, upstream credentials, and API keys are not persisted by default. The database records operational metadata only and never becomes a source of truth for Electron campaign state.

## 7. Configuration and Deployment

Configuration is environment-only:

- `DATABASE_URL`
- `UPSTREAM_BASE_URL`, `UPSTREAM_API_KEY`, `CHAT_MODEL`
- `EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL`
- `RAG_INDEX_PATH`

The default development path uses SQLite and a locally running Ollama-compatible endpoint. Docker assets provide an API-plus-PostgreSQL path. Secrets remain environment variables and are excluded from logs, responses, and database rows.

## 8. Error Handling

- Invalid request data uses FastAPI/Pydantic validation responses.
- Unsupported streaming requests return a clear client error.
- Upstream chat or embedding failures return `503 Service Unavailable` without exposing credentials or raw upstream bodies.
- Missing RAG data causes chat to fall back to base mode while `/health` reports `rag_ready=false`; direct retrieval returns a clear unavailable response.
- Database recording failures do not turn a successful model response into a failed response, but they are reflected in service diagnostics.

## 9. Benchmark Repair

The current uncommitted benchmark always loads the vector index so it can compute retrieval Recall@3, but it also passes that index into generation for `mode=base`. This invalidates the base-versus-RAG comparison.

Mode selection will be extracted into a small pure helper and covered by a regression test. The index may remain available for retrieval-only metrics, while generation receives retrieval dependencies only for `rag` and `lora` modes. Existing numerical reports will not be promoted in the root README until base and RAG have been rerun with the repaired isolation.

## 10. Testing

Tests run without a live model or API key by injecting fake chat and embedding dependencies.

- API tests cover health, request validation, non-streaming chat response shape, RAG fallback, retrieval output, and upstream failure mapping.
- Gateway tests cover cosine ranking and deterministic dice behavior.
- Storage tests create real SQLite tables and verify metadata persistence without prompt content.
- PostgreSQL configuration and driver selection are covered locally. A live PostgreSQL integration test runs only when a test database URL is supplied; Docker availability determines whether it can be executed in the current environment.
- A TypeScript regression test proves base mode does not inject retrieval dependencies.
- Existing LangChain-layer tests and TypeScript typecheck remain part of the focused verification set.

No claim of full PostgreSQL integration-test success will be made unless a live PostgreSQL test actually runs.

## 11. Documentation and Recruitment Surface

The root README will lead with the runnable product, architecture, screenshots or existing diagrams, and a concise capability matrix. It will document the FastAPI startup command, SQLite/PostgreSQL selection, API examples, and the relationship between the gateway and Electron.

Wording will distinguish three states:

- Completed: FastAPI gateway, LangChain chat/RAG/Agent paths, REST endpoints, SQLite/PostgreSQL backend selection, Docker assets, and the Windows client.
- Pending experiment: actual LoRA training result and regenerated base/RAG/LoRA benchmark.
- Extension points: streaming, async jobs, and production monitoring.

Extension points are documented as future work and are not presented as implemented functionality.

## 12. Success Criteria

- The service starts with SQLite using documented commands and `/health` responds successfully.
- The service can switch to PostgreSQL by changing only `DATABASE_URL`.
- Non-streaming chat, direct retrieval, and rule-Agent endpoints have executable implementations and offline tests.
- Electron can be configured to target the gateway through its existing OpenAI-compatible provider boundary.
- Base benchmark generation cannot receive RAG dependencies, enforced by a regression test.
- Focused Python tests, focused Electron AI tests, and TypeScript typecheck pass.
- Documentation contains no claim that LoRA results, streaming, queues, or monitoring are already complete.
