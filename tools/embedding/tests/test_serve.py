import asyncio
import inspect
from pathlib import Path
import threading
import time

import pytest

from fastapi.testclient import TestClient

import tools.embedding.serve as serve_module
from tools.embedding.serve import create_app


class FakeVectors:
    def __init__(self, values):
        self.values = values

    def tolist(self):
        return self.values


class FakeModel:
    def __init__(self, *, fail: bool = False):
        self.fail = fail
        self.calls = []

    def encode(self, texts, **kwargs):
        self.calls.append((list(texts), kwargs, threading.current_thread().name))
        if self.fail:
            raise RuntimeError("C:/private/models/key-sk-secret/weights failed")
        return FakeVectors([[float(index), 1.0] for index, _ in enumerate(texts)])


def test_embeddings_contract_and_server_controlled_model_name():
    fake = FakeModel()
    loads = []

    def loader(path):
        loads.append(path)
        return fake

    app = create_app(
        model_path=Path("models/private-adapter"),
        served_model_name="bge-small-zh-trpg",
        model_loader=loader,
    )

    with TestClient(app) as client:
        response = client.post(
            "/v1/embeddings",
            json={"model": "caller-cannot-rename-model", "input": ["铜钟", "车票"]},
        )
        second = client.post("/v1/embeddings", json={"model": "anything", "input": "钥匙"})

    assert response.status_code == 200
    assert response.json() == {
        "object": "list",
        "data": [
            {"object": "embedding", "index": 0, "embedding": [0.0, 1.0]},
            {"object": "embedding", "index": 1, "embedding": [1.0, 1.0]},
        ],
        "model": "bge-small-zh-trpg",
        "usage": {"prompt_tokens": 0, "total_tokens": 0},
    }
    assert second.status_code == 200
    assert len(loads) == 1
    assert [call[0] for call in fake.calls] == [["铜钟", "车票"], ["钥匙"]]


@pytest.mark.parametrize(
    "payload",
    [
        {"model": "trpg", "input": ""},
        {"model": "trpg", "input": "   "},
        {"model": "trpg", "input": []},
        {"model": "trpg", "input": ["铜钟", "\t"]},
        {"model": "   ", "input": "铜钟"},
    ],
)
def test_empty_model_or_input_returns_422(payload):
    with TestClient(create_app("model", model_loader=lambda _path: FakeModel())) as client:
        response = client.post("/v1/embeddings", json=payload)

    assert response.status_code == 422


def test_load_failure_returns_sanitized_503():
    def failing_loader(_path):
        raise RuntimeError("C:/private/models/sk-secret/model failed")

    with TestClient(create_app("model", model_loader=failing_loader)) as client:
        response = client.post(
            "/v1/embeddings",
            json={"model": "trpg", "input": "铜钟"},
            headers={"authorization": "Bearer sk-header-secret"},
        )

    assert response.status_code == 503
    rendered = response.text
    assert "private" not in rendered
    assert "sk-secret" not in rendered
    assert "sk-header-secret" not in rendered
    assert "traceback" not in rendered.lower()


def test_encode_failure_returns_sanitized_503():
    with TestClient(create_app("model", model_loader=lambda _path: FakeModel(fail=True))) as client:
        response = client.post(
            "/v1/embeddings",
            json={"model": "trpg", "input": "铜钟"},
        )

    assert response.status_code == 503
    assert response.json() == {"detail": "embedding model unavailable"}
    assert "private" not in response.text


def test_encode_is_sent_to_thread(monkeypatch):
    fake = FakeModel()
    original = asyncio.to_thread
    calls = []

    async def recording_to_thread(function, *args, **kwargs):
        calls.append(function)
        return await original(function, *args, **kwargs)

    monkeypatch.setattr(asyncio, "to_thread", recording_to_thread)
    with TestClient(create_app("model", model_loader=lambda _path: fake)) as client:
        response = client.post("/v1/embeddings", json={"model": "trpg", "input": "铜钟"})

    assert response.status_code == 200
    assert any(getattr(function, "__name__", "") == "_encode" for function in calls)
    assert fake.calls[0][2] != threading.current_thread().name


def test_concurrent_requests_do_not_overlap_encode():
    active = 0
    maximum_active = 0
    guard = threading.Lock()

    class DetectingModel(FakeModel):
        def encode(self, texts, **kwargs):
            nonlocal active, maximum_active
            with guard:
                active += 1
                maximum_active = max(maximum_active, active)
            time.sleep(0.02)
            with guard:
                active -= 1
            return FakeVectors([[1.0, 2.0] for _ in texts])

    app = create_app("model", model_loader=lambda _path: DetectingModel())

    async def send_two_requests():
        import httpx

        transport = httpx.ASGITransport(app=app)
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                return await asyncio.gather(
                    client.post("/v1/embeddings", json={"model": "trpg", "input": "铜钟"}),
                    client.post("/v1/embeddings", json={"model": "trpg", "input": "车票"}),
                )

    responses = asyncio.run(send_two_requests())

    assert all(response.status_code == 200 for response in responses)
    assert maximum_active == 1


def test_sentence_transformer_dependency_remains_lazy():
    source = inspect.getsource(serve_module)
    prefix = source.split("def load_sentence_transformer", 1)[0]

    assert "sentence_transformers" not in prefix


def test_cli_reads_model_and_network_settings_from_environment(monkeypatch):
    monkeypatch.setenv("TRPG_EMBEDDING_MODEL_PATH", "models/trpg")
    monkeypatch.setenv("TRPG_EMBEDDING_SERVED_MODEL", "trpg-embedding-v1")
    monkeypatch.setenv("TRPG_EMBEDDING_HOST", "0.0.0.0")
    monkeypatch.setenv("TRPG_EMBEDDING_PORT", "9010")

    args = serve_module.parse_args([])

    assert args.model_path == "models/trpg"
    assert args.served_model_name == "trpg-embedding-v1"
    assert args.host == "0.0.0.0"
    assert args.port == 9010
