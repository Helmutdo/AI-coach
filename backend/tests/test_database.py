"""Database setup and FastAPI lifespan integration."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import inspect

from database.database import engine, get_db
from main import app


def test_get_db_yields_session():
    gen = get_db()
    session = next(gen)
    try:
        assert session.bind is engine
    finally:
        try:
            next(gen)
        except StopIteration:
            pass


def test_lifespan_init_db_creates_tables():
    with TestClient(app):
        insp = inspect(engine)
        assert sorted(insp.get_table_names()) == [
            "chat_messages",
            "daily_metrics",
            "garmin_activities",
            "user_settings",
            "users",
        ]
