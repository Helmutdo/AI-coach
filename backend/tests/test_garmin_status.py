"""Tests for GET /api/garmin/status has_data field."""
from __future__ import annotations

import uuid
import pytest
from fastapi.testclient import TestClient

from dependencies.auth import get_current_user_id
from main import app
from database.database import get_db
from models.models import GarminActivity
from datetime import datetime, timezone


@pytest.fixture
def test_user_id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def client_with_auth(test_user_id: str):
    def override() -> str:
        return test_user_id
    app.dependency_overrides[get_current_user_id] = override
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


def test_garmin_status_has_data_false_when_no_activities(client_with_auth):
    r = client_with_auth.get("/api/auth/garmin/status")
    assert r.status_code == 200
    data = r.json()
    assert "has_data" in data
    assert data["has_data"] is False


def test_garmin_status_has_data_true_after_csv_import(client_with_auth, test_user_id):
    uid = uuid.UUID(test_user_id)
    # Insert a garmin activity directly
    db_gen = get_db()
    db = next(db_gen)
    try:
        act = GarminActivity(
            user_id=uid,
            activity_id="csv_test_001",
            activity_name="Test Run",
            activity_type="Running",
            start_time=datetime(2026, 1, 1, tzinfo=timezone.utc),
            synced_at=datetime.now(timezone.utc),
            raw_data={"source": "csv"},
        )
        db.add(act)
        db.commit()
    finally:
        try:
            next(db_gen)
        except StopIteration:
            pass

    r = client_with_auth.get("/api/auth/garmin/status")
    assert r.status_code == 200
    assert r.json()["has_data"] is True
