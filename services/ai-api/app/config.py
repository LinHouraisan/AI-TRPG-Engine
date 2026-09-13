from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./data/ai-api.db"
    upstream_base_url: str = "https://api.deepseek.com"
    upstream_api_key: str = ""
    chat_model: str = "deepseek-v4-flash"
    embedding_base_url: str = "http://127.0.0.1:11434/v1"
    embedding_api_key: str = "ollama"
    embedding_model: str = "bge-m3"
    retriever_backend: str = "json"
    rag_index_path: str = "../../electron/data/rag-index.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()
