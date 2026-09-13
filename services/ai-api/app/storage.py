from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel
from sqlalchemy import DateTime, ForeignKey, Integer, String, create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class ApiSession(Base):
    __tablename__ = "api_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class CallRecord(BaseModel):
    endpoint: str
    model: str
    status: str
    latency_ms: int
    prompt_tokens: int = 0
    completion_tokens: int = 0
    session_id: str | None = None


class ApiCall(Base):
    __tablename__ = "api_calls"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("api_sessions.id"), index=True
    )
    endpoint: Mapped[str] = mapped_column(String(80))
    model: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20), index=True)
    latency_ms: Mapped[int] = mapped_column(Integer)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, index=True
    )

    @classmethod
    def from_record(cls, item: CallRecord) -> "ApiCall":
        return cls(id=str(uuid4()), **item.model_dump())


class CallRecorder:
    def __init__(self, database_url: str):
        kwargs = (
            {"connect_args": {"check_same_thread": False}}
            if database_url.startswith("sqlite")
            else {}
        )
        self.engine = create_engine(database_url, **kwargs)

    def init_schema(self) -> None:
        Base.metadata.create_all(self.engine)

    def ping(self) -> bool:
        try:
            with self.engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            return True
        except SQLAlchemyError:
            return False

    def record(self, item: CallRecord) -> bool:
        try:
            with Session(self.engine) as session:
                session.add(ApiCall.from_record(item))
                session.commit()
            return True
        except SQLAlchemyError:
            return False
