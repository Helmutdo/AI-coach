"""SQLite engine, declarative base, session factory, and FastAPI dependency."""

from __future__ import annotations

import os
from collections.abc import Generator
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

# Load .env from backend directory (parent of database/)
_env_dir = Path(__file__).resolve().parent.parent
load_dotenv(_env_dir / ".env")

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./garmin_coach.db")

# SQLite needs check_same_thread=False for use across FastAPI worker threads.
_engine_kwargs: dict = {}
if DATABASE_URL.startswith("sqlite"):
    _engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, **_engine_kwargs)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""

    pass


def _sqlite_add_chat_conversation_id() -> None:
    """Add conversation_id to chat_messages if missing (SQLite dev DBs)."""
    if not DATABASE_URL.startswith("sqlite"):
        return
    insp = inspect(engine)
    if not insp.has_table("chat_messages"):
        return
    cols = {c["name"] for c in insp.get_columns("chat_messages")}
    if "conversation_id" in cols:
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE chat_messages ADD COLUMN conversation_id VARCHAR(64) NOT NULL DEFAULT 'default'"
            )
        )


def init_db() -> None:
    """Import models and create all tables (development / simple deployments)."""
    import models.models  # noqa: F401 — registers tables on Base.metadata

    Base.metadata.create_all(bind=engine)
    _sqlite_add_chat_conversation_id()


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: yields a DB session and closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
