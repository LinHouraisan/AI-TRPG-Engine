from app.config import Settings


def test_settings_default_to_local_sqlite_and_json_retrieval(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    settings = Settings(_env_file=None)

    assert settings.database_url == "sqlite:///./data/ai-api.db"
    assert settings.retriever_backend == "json"
    assert settings.upstream_base_url == "https://api.deepseek.com"
    assert settings.chat_model == "deepseek-v4-flash"
    assert settings.embedding_model == "bge-m3"


def test_settings_accept_postgresql_url(monkeypatch):
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql+psycopg://trpg:trpg@localhost:5432/trpg",
    )

    settings = Settings(_env_file=None)

    assert settings.database_url.startswith("postgresql+psycopg://")

