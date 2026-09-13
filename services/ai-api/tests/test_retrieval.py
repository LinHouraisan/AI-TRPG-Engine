import json
from pathlib import Path

import pytest

from app.config import Settings
from app.retrieval import JsonVectorRetriever, Retriever, create_retriever


class FakeEmbedder:
    async def aembed_query(self, text: str) -> list[float]:
        return [1.0, 0.0] if "账本" in text else [0.0, 1.0]


@pytest.mark.asyncio
async def test_json_retriever_ranks_loaded_snapshot_after_source_is_removed(tmp_path: Path):
    index = tmp_path / "rag-index.json"
    index.write_text(
        json.dumps(
            {
                "dim": 2,
                "docs": [
                    {
                        "id": "book",
                        "text": "黑色账本",
                        "source": "facts",
                        "vector": [1, 0],
                    },
                    {
                        "id": "room",
                        "text": "二楼书房",
                        "source": "rooms",
                        "vector": [0, 1],
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    retriever = JsonVectorRetriever(index, FakeEmbedder())

    await retriever.load()
    index.unlink()
    hits = await retriever.retrieve("账本在哪里", 1)

    assert hits[0].id == "book"
    assert hits[0].score == pytest.approx(1.0)
    assert isinstance(retriever, Retriever)


@pytest.mark.asyncio
async def test_missing_index_is_not_ready(tmp_path: Path):
    retriever = JsonVectorRetriever(tmp_path / "missing.json", FakeEmbedder())

    await retriever.load()

    assert retriever.ready() is False
    assert await retriever.retrieve("账本", 3) == []


def test_factory_rejects_unknown_backend(tmp_path: Path):
    settings = Settings(
        retriever_backend="milvus",
        rag_index_path=str(tmp_path / "index.json"),
        _env_file=None,
    )

    with pytest.raises(ValueError, match="milvus"):
        create_retriever(settings, FakeEmbedder())

