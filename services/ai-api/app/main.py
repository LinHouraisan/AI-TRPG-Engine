import asyncio
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.engine import make_url

from app.config import Settings, get_settings
from app.gateway import ChatGateway, build_gateway
from app.storage import CallRecord, CallRecorder


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ChatCompletionRequest(BaseModel):
    model: str | None = None
    messages: list[ChatMessage] = Field(min_length=1)
    temperature: float = Field(default=0.7, ge=0, le=2)
    stream: bool = False
    rag: bool = False


class RetrieveRequest(BaseModel):
    query: str = Field(min_length=1)
    top_k: int = Field(default=3, ge=1, le=20)


class RuleRequest(BaseModel):
    action: str = Field(min_length=1)
    seed: str = Field(min_length=1)
    turn_id: str = Field(min_length=1)


def _ensure_sqlite_parent(database_url: str) -> None:
    url = make_url(database_url)
    if url.get_backend_name() != "sqlite" or not url.database or url.database == ":memory:":
        return
    Path(url.database).parent.mkdir(parents=True, exist_ok=True)


def create_app(
    settings: Settings | None = None,
    gateway: ChatGateway | None = None,
    recorder: CallRecorder | None = None,
) -> FastAPI:
    resolved = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        _ensure_sqlite_parent(resolved.database_url)
        app.state.recorder = recorder or CallRecorder(resolved.database_url)
        await asyncio.to_thread(app.state.recorder.init_schema)
        app.state.gateway = gateway or await build_gateway(resolved)
        yield
        app.state.recorder.engine.dispose()

    service = FastAPI(title="AI TRPG Gateway", version="0.1.0", lifespan=lifespan)

    @service.get("/health")
    async def health():
        database_ready = await asyncio.to_thread(service.state.recorder.ping)
        return {
            "status": "ok" if database_ready else "degraded",
            "database_ready": database_ready,
            "rag_ready": bool(service.state.gateway.rag_ready),
        }

    @service.post("/v1/retrieve")
    async def retrieve(request: RetrieveRequest):
        documents = await service.state.gateway.retrieve(request.query, request.top_k)
        return {
            "documents": [
                item.model_dump() if isinstance(item, BaseModel) else item
                for item in documents
            ]
        }

    @service.post("/v1/chat/completions")
    async def chat_completion(request: ChatCompletionRequest):
        if request.stream:
            raise HTTPException(status_code=400, detail="暂不支持流式响应")

        model = request.model or resolved.chat_model
        started = time.perf_counter()
        try:
            result = await service.state.gateway.complete(
                [item.model_dump() for item in request.messages],
                model,
                request.temperature,
                request.rag,
            )
        except Exception:
            latency_ms = int((time.perf_counter() - started) * 1000)
            await asyncio.to_thread(
                service.state.recorder.record,
                CallRecord(
                    endpoint="/v1/chat/completions",
                    model=model,
                    status="error",
                    latency_ms=latency_ms,
                ),
            )
            raise HTTPException(status_code=503, detail="上游模型暂时不可用") from None

        prompt_tokens = int(result.get("prompt_tokens", 0))
        completion_tokens = int(result.get("completion_tokens", 0))
        latency_ms = int((time.perf_counter() - started) * 1000)
        await asyncio.to_thread(
            service.state.recorder.record,
            CallRecord(
                endpoint="/v1/chat/completions",
                model=result.get("model", model),
                status="ok",
                latency_ms=latency_ms,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
            ),
        )
        return {
            "id": f"chatcmpl-{uuid4().hex}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": result.get("model", model),
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": result["text"]},
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            },
        }

    @service.post("/v1/agent/rules")
    async def resolve_rules(request: RuleRequest):
        started = time.perf_counter()
        try:
            result = await service.state.gateway.resolve_rules(
                request.action, request.seed, request.turn_id
            )
        except Exception:
            await asyncio.to_thread(
                service.state.recorder.record,
                CallRecord(
                    endpoint="/v1/agent/rules",
                    model=resolved.chat_model,
                    status="error",
                    latency_ms=int((time.perf_counter() - started) * 1000),
                ),
            )
            raise HTTPException(status_code=503, detail="规则 Agent 暂时不可用") from None

        await asyncio.to_thread(
            service.state.recorder.record,
            CallRecord(
                endpoint="/v1/agent/rules",
                model=resolved.chat_model,
                status=result.status,
                latency_ms=int((time.perf_counter() - started) * 1000),
            ),
        )
        return result

    return service


app = create_app()
