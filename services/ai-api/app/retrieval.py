import asyncio
import json
import math
from pathlib import Path
from typing import Protocol, runtime_checkable

from pydantic import BaseModel

from app.config import Settings


class RetrievedDocument(BaseModel):
    id: str
    text: str
    source: str
    score: float


class Embedder(Protocol):
    async def aembed_query(self, text: str) -> list[float]: ...


@runtime_checkable
class Retriever(Protocol):
    async def retrieve(self, query: str, top_k: int) -> list[RetrievedDocument]: ...

    def ready(self) -> bool: ...


class _IndexedDocument(BaseModel):
    id: str
    text: str
    source: str
    vector: list[float]


def _cosine(left: list[float], right: list[float]) -> float:
    if not left or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right, strict=True))
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if not left_norm or not right_norm:
        return 0.0
    return dot / (left_norm * right_norm)


class JsonVectorRetriever:
    def __init__(self, path: Path, embedder: Embedder):
        self._path = path
        self._embedder = embedder
        self._index: tuple[_IndexedDocument, ...] = ()

    def _read_index(self) -> tuple[_IndexedDocument, ...]:
        try:
            payload = json.loads(self._path.read_text(encoding="utf-8"))
            return tuple(_IndexedDocument.model_validate(item) for item in payload["docs"])
        except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
            return ()

    async def load(self) -> None:
        self._index = await asyncio.to_thread(self._read_index)

    def ready(self) -> bool:
        return bool(self._index)

    async def retrieve(self, query: str, top_k: int) -> list[RetrievedDocument]:
        if not self._index or top_k <= 0:
            return []
        query_vector = await self._embedder.aembed_query(query)
        ranked = sorted(
            (
                RetrievedDocument(
                    id=item.id,
                    text=item.text,
                    source=item.source,
                    score=_cosine(query_vector, item.vector),
                )
                for item in self._index
            ),
            key=lambda item: item.score,
            reverse=True,
        )
        return ranked[:top_k]


def create_retriever(settings: Settings, embedder: Embedder) -> Retriever:
    if settings.retriever_backend != "json":
        raise ValueError(f"不支持的 Retriever backend: {settings.retriever_backend}")
    return JsonVectorRetriever(Path(settings.rag_index_path), embedder)
