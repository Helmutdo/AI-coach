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


def _migrate_user_settings_secrets() -> None:
    """Add garmin_token_encrypted; rename ai_api_key → ai_api_key_encrypted (existing DBs)."""
    insp = inspect(engine)
    if not insp.has_table("user_settings"):
        return
    cols = {c["name"] for c in insp.get_columns("user_settings")}
    with engine.begin() as conn:
        if "garmin_token_encrypted" not in cols:
            conn.execute(text("ALTER TABLE user_settings ADD COLUMN garmin_token_encrypted TEXT"))
        cols2 = {c["name"] for c in inspect(engine).get_columns("user_settings")}
        if "ai_api_key" in cols2 and "ai_api_key_encrypted" not in cols2:
            conn.execute(text("ALTER TABLE user_settings RENAME COLUMN ai_api_key TO ai_api_key_encrypted"))


def _migrate_user_settings_strava() -> None:
    """Add Strava OAuth columns on existing user_settings (SQLite / Postgres)."""
    insp = inspect(engine)
    if not insp.has_table("user_settings"):
        return
    cols = {c["name"] for c in insp.get_columns("user_settings")}
    dialect = engine.dialect.name
    stmts: list[str] = []
    if "strava_access_token_encrypted" not in cols:
        stmts.append(
            "ALTER TABLE user_settings ADD COLUMN strava_access_token_encrypted TEXT"
        )
    if "strava_refresh_token_encrypted" not in cols:
        stmts.append(
            "ALTER TABLE user_settings ADD COLUMN strava_refresh_token_encrypted TEXT"
        )
    if "strava_token_expires_at" not in cols:
        stmts.append("ALTER TABLE user_settings ADD COLUMN strava_token_expires_at INTEGER")
    if "strava_athlete_id" not in cols:
        stmts.append("ALTER TABLE user_settings ADD COLUMN strava_athlete_id TEXT")
    if "strava_athlete_name" not in cols:
        stmts.append("ALTER TABLE user_settings ADD COLUMN strava_athlete_name TEXT")
    if "strava_connected" not in cols:
        if dialect == "sqlite":
            stmts.append(
                "ALTER TABLE user_settings ADD COLUMN strava_connected INTEGER NOT NULL DEFAULT 0"
            )
        else:
            stmts.append(
                "ALTER TABLE user_settings ADD COLUMN strava_connected BOOLEAN NOT NULL DEFAULT false"
            )
    if not stmts:
        return
    with engine.begin() as conn:
        for s in stmts:
            conn.execute(text(s))


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
    _migrate_user_settings_secrets()
    _sqlite_add_chat_conversation_id()
    _migrate_user_settings_strava()


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: yields a DB session and closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
