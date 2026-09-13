"""Serve one local SentenceTransformer model through an embeddings endpoint."""

from __future__ import annotations

import argparse
import asyncio
from contextlib import asynccontextmanager
import os
from pathlib import Path
import threading
from typing import Callable

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, field_validator


class EmbeddingRequest(BaseModel):
    model: str
    input: str | list[str]

    @field_validator("model")
    @classmethod
    def validate_model(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("model must not be blank")
        return value

    @field_validator("input")
    @classmethod
    def validate_input(cls, value: str | list[str]) -> str | list[str]:
        values = [value] if isinstance(value, str) else value
        if not values or any(not item.strip() for item in values):
            raise ValueError("input must contain non-blank text")
        return value


def load_sentence_transformer(model_path: str | Path):
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(str(model_path))


def create_app(
    model_path: str | Path,
    *,
    served_model_name: str | None = None,
    model_loader: Callable[[str | Path], object] = load_sentence_transformer,
) -> FastAPI:
    """Create a single-model app; callers cannot choose or relabel the loaded model."""

    path = Path(model_path)
    public_model_name = (
        served_model_name.strip() if served_model_name and served_model_name.strip() else path.name
    ) or "embedding-model"
    encode_lock = threading.Lock()

    def _encode(model: object, texts: list[str]):
        with encode_lock:
            return model.encode(
                texts,
                convert_to_numpy=True,
                show_progress_bar=False,
            )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.embedding_model = None
        try:
            app.state.embedding_model = await asyncio.to_thread(model_loader, path)
        except Exception:
            # Stay available so the caller receives 503 and can use its existing fallback.
            pass
        yield
        app.state.embedding_model = None

    app = FastAPI(title="TRPG Embeddings", version="0.1.0", lifespan=lifespan)

    @app.post("/v1/embeddings")
    async def embeddings(request: EmbeddingRequest):
        model = app.state.embedding_model
        if model is None:
            raise HTTPException(status_code=503, detail="embedding model unavailable")

        texts = [request.input] if isinstance(request.input, str) else request.input
        try:
            encoded = await asyncio.to_thread(_encode, model, texts)
            vectors = encoded.tolist() if hasattr(encoded, "tolist") else list(encoded)
            if len(vectors) != len(texts):
                raise ValueError("embedding count mismatch")
            data = [
                {"object": "embedding", "index": index, "embedding": list(vector)}
                for index, vector in enumerate(vectors)
            ]
        except Exception:
            raise HTTPException(status_code=503, detail="embedding model unavailable") from None

        return {
            "object": "list",
            "data": data,
            "model": public_model_name,
            "usage": {"prompt_tokens": 0, "total_tokens": 0},
        }

    return app


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve a local TRPG embedding model")
    parser.add_argument(
        "--model-path",
        default=os.environ.get("TRPG_EMBEDDING_MODEL_PATH"),
        help="local model directory (env: TRPG_EMBEDDING_MODEL_PATH)",
    )
    parser.add_argument(
        "--served-model-name",
        default=os.environ.get("TRPG_EMBEDDING_SERVED_MODEL"),
        help="server-controlled model name (env: TRPG_EMBEDDING_SERVED_MODEL)",
    )
    parser.add_argument(
        "--host",
        default=os.environ.get("TRPG_EMBEDDING_HOST", "127.0.0.1"),
        help="bind host (env: TRPG_EMBEDDING_HOST)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("TRPG_EMBEDDING_PORT", "8001")),
        help="bind port (env: TRPG_EMBEDDING_PORT)",
    )
    args = parser.parse_args(argv)
    if not args.model_path:
        parser.error("--model-path or TRPG_EMBEDDING_MODEL_PATH is required")
    return args


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    import uvicorn

    uvicorn.run(
        create_app(args.model_path, served_model_name=args.served_model_name),
        host=args.host,
        port=args.port,
    )


if __name__ == "__main__":
    main()
