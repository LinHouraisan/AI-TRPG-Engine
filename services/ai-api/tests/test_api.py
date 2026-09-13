from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


class FakeGateway:
    rag_ready = True

    async def retrieve(self, query: str, top_k: int):
        return [
            {
                "id": "book",
                "text": "黑色账本",
                "source": "facts",
                "score": 1.0,
            }
        ][:top_k]

    async def complete(self, messages, model, temperature, use_rag):
        return {
            "text": "门后传来脚步声。",
            "model": model,
            "prompt_tokens": 3,
            "completion_tokens": 6,
        }


class FailingGateway(FakeGateway):
    async def complete(self, messages, model, temperature, use_rag):
        raise RuntimeError("https://api.deepseek.com sk-secret-value")


def _settings(tmp_path):
    return Settings(database_url=f"sqlite:///{tmp_path / 'api.db'}", _env_file=None)


def test_health_and_openai_compatible_chat(tmp_path):
    with TestClient(create_app(settings=_settings(tmp_path), gateway=FakeGateway())) as client:
        health = client.get("/health")
        response = client.post(
            "/v1/chat/completions",
            json={
                "model": "fake-model",
                "messages": [{"role": "user", "content": "推门"}],
                "rag": True,
            },
        )

    assert health.status_code == 200
    assert health.json() == {
        "status": "ok",
        "database_ready": True,
        "rag_ready": True,
    }
    body = response.json()
    assert response.status_code == 200
    assert body["object"] == "chat.completion"
    assert body["choices"][0]["message"] == {
        "role": "assistant",
        "content": "门后传来脚步声。",
    }
    assert body["usage"] == {
        "prompt_tokens": 3,
        "completion_tokens": 6,
        "total_tokens": 9,
    }


def test_retrieve_returns_stable_document_shape(tmp_path):
    with TestClient(create_app(settings=_settings(tmp_path), gateway=FakeGateway())) as client:
        response = client.post("/v1/retrieve", json={"query": "账本在哪里", "top_k": 1})

    assert response.status_code == 200
    assert response.json() == {
        "documents": [
            {
                "id": "book",
                "text": "黑色账本",
                "source": "facts",
                "score": 1.0,
            }
        ]
    }


def test_streaming_is_explicitly_rejected(tmp_path):
    with TestClient(create_app(settings=_settings(tmp_path), gateway=FakeGateway())) as client:
        response = client.post(
            "/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": "推门"}],
                "stream": True,
            },
        )

    assert response.status_code == 400
    assert "暂不支持流式" in response.json()["detail"]


def test_upstream_failure_returns_redacted_503(tmp_path):
    with TestClient(create_app(settings=_settings(tmp_path), gateway=FailingGateway())) as client:
        response = client.post(
            "/v1/chat/completions",
            json={"messages": [{"role": "user", "content": "推门"}]},
        )

    assert response.status_code == 503
    assert "api.deepseek.com" not in response.text
    assert "sk-secret-value" not in response.text

