import os

import pytest

from app.storage import CallRecord, CallRecorder


@pytest.mark.skipif(
    not os.getenv("TEST_DATABASE_URL"), reason="未提供测试 PostgreSQL"
)
def test_postgresql_round_trip():
    recorder = CallRecorder(os.environ["TEST_DATABASE_URL"])
    recorder.init_schema()
    assert recorder.ping()
    assert recorder.record(
        CallRecord(
            endpoint="/health",
            model="none",
            status="ok",
            latency_ms=1,
        )
    )
    recorder.engine.dispose()
