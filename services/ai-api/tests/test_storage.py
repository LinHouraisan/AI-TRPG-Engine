from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from app.storage import ApiCall, CallRecord, CallRecorder


def test_sqlite_records_metadata_without_content(tmp_path):
    recorder = CallRecorder(f"sqlite:///{tmp_path / 'calls.db'}")
    recorder.init_schema()
    saved = recorder.record(
        CallRecord(
            endpoint="/v1/chat/completions",
            model="fake-model",
            status="ok",
            latency_ms=12,
            prompt_tokens=4,
            completion_tokens=7,
        )
    )

    with Session(recorder.engine) as session:
        row = session.scalar(select(ApiCall))
    columns = {column["name"] for column in inspect(recorder.engine).get_columns("api_calls")}

    assert saved is True
    assert row is not None
    assert row.endpoint == "/v1/chat/completions"
    assert row.prompt_tokens == 4
    assert "prompt" not in columns
    assert "response" not in columns


def test_postgresql_url_selects_postgresql_driver_without_connecting():
    recorder = CallRecorder("postgresql+psycopg://trpg:trpg@localhost:5432/trpg")

    assert recorder.engine.dialect.name == "postgresql"
    recorder.engine.dispose()

