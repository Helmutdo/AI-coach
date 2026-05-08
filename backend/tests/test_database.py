"""Database setup and FastAPI lifespan integration."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import inspect, text

from database.database import get_db
from main import app


def test_get_db_yields_usable_session():
    gen = get_db()
    session = next(gen)
    try:
        session.execute(text("SELECT 1"))
    finally:
        try:
            next(gen)
        except StopIteration:
            pass


def test_lifespan_init_db_creates_tables():
    with TestClient(app):
        from database.database import engine
        insp = inspect(engine)
        assert sorted(insp.get_table_names()) == [
            "chat_messages",
            "daily_metrics",
            "garmin_activities",
            "strava_activities",
            "user_settings",
            "users",
        ]
