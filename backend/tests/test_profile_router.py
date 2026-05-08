"""Tests for profile router endpoints and format_profile_for_prompt."""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient

from dependencies.auth import get_current_user_id
from main import app
from models.models import AthleteProfile
from routers.profile_router import format_profile_for_prompt


@pytest.fixture
def test_user_id() -> str:
    """Fixed test user UUID."""
    return str(uuid.uuid4())


@pytest.fixture
def client_with_auth(test_user_id: str) -> TestClient:
    """TestClient with overridden auth to inject test user ID."""
    def override_get_current_user_id() -> str:
        return test_user_id

    app.dependency_overrides[get_current_user_id] = override_get_current_user_id
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


def test_get_profile_not_found(client_with_auth: TestClient) -> None:
    """GET /api/profile returns 404 when no profile exists."""
    r = client_with_auth.get("/api/profile")
    assert r.status_code == 404
    assert r.json()["detail"] == "Profile not found"


def test_post_profile_creates_new(client_with_auth: TestClient) -> None:
    """POST /api/profile creates a new profile."""
    payload = {
        "sex": "male",
        "birth_year": 1990,
        "weight_kg": 75.0,
        "height_cm": 180.0,
        "injuries": "none",
    }
    r = client_with_auth.post("/api/profile", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["sex"] == "male"
    assert data["birth_year"] == 1990
    assert data["weight_kg"] == 75.0
    assert data["height_cm"] == 180.0
    assert data["injuries"] == "none"


def test_post_profile_upsert(client_with_auth: TestClient) -> None:
    """POST /api/profile again updates existing profile (upsert behavior)."""
    # Create initial profile
    payload1 = {
        "sex": "male",
        "birth_year": 1990,
        "weight_kg": 75.0,
        "height_cm": 180.0,
        "injuries": "none",
    }
    r1 = client_with_auth.post("/api/profile", json=payload1)
    assert r1.status_code == 200

    # Upsert with updated data
    payload2 = {
        "sex": "male",
        "birth_year": 1990,
        "weight_kg": 76.0,  # Changed
        "height_cm": 180.0,
        "injuries": "knee pain",  # Changed
        "hours_per_week": 10.0,
        "experience": "amateur",
    }
    r2 = client_with_auth.post("/api/profile", json=payload2)
    assert r2.status_code == 200
    data = r2.json()
    assert data["weight_kg"] == 76.0
    assert data["injuries"] == "knee pain"
    assert data["hours_per_week"] == 10.0
    assert data["experience"] == "amateur"

    # Verify get returns the updated profile
    r3 = client_with_auth.get("/api/profile")
    assert r3.status_code == 200
    data3 = r3.json()
    assert data3["weight_kg"] == 76.0
    assert data3["injuries"] == "knee pain"


def test_get_profile_after_post(client_with_auth: TestClient) -> None:
    """GET /api/profile succeeds after POST creates profile."""
    payload = {
        "sex": "female",
        "birth_year": 1995,
        "weight_kg": 65.0,
        "height_cm": 170.0,
        "injuries": "none",
    }
    r1 = client_with_auth.post("/api/profile", json=payload)
    assert r1.status_code == 200

    r2 = client_with_auth.get("/api/profile")
    assert r2.status_code == 200
    data = r2.json()
    assert data["sex"] == "female"


def test_format_profile_for_prompt_full() -> None:
    """format_profile_for_prompt with full profile includes all fields."""
    profile = AthleteProfile(
        user_id=uuid.uuid4(),
        sex="male",
        birth_year=1990,
        weight_kg=75.0,
        height_cm=180.0,
        injuries="mild knee pain",
        hours_per_week=10.0,
        experience="amateur",
        years_in_triathlon=5,
        target_distance="70.3",
        primary_goal="finish",
        next_race_date="September 2026",
    )
    prompt = format_profile_for_prompt(profile)

    # Check expected substrings are present
    assert "Male" in prompt or "male" in prompt.lower()
    assert str(date.today().year - 1990) in prompt  # age
    assert "75.0kg" in prompt
    assert "180.0cm" in prompt
    assert "Amateur" in prompt or "amateur" in prompt.lower()
    assert "5 years in triathlon" in prompt
    assert "70.3" in prompt
    assert "Finish" in prompt or "finish" in prompt.lower()
    assert "mild knee pain" in prompt
    assert "10.0h/week" in prompt
    assert "September 2026" in prompt


def test_format_profile_for_prompt_minimal() -> None:
    """format_profile_for_prompt with minimal fields produces short output."""
    profile = AthleteProfile(
        user_id=uuid.uuid4(),
        sex="female",
        birth_year=1985,
        weight_kg=65.0,
        height_cm=170.0,
        injuries="none",
    )
    prompt = format_profile_for_prompt(profile)

    # Should contain basic info
    assert "Female" in prompt or "female" in prompt.lower()
    assert str(date.today().year - 1985) in prompt
    assert "65.0kg" in prompt
    assert "170.0cm" in prompt

    # Should not contain optional fields
    assert "Experience" not in prompt
    assert "Target:" not in prompt
    assert "Health notes:" not in prompt
    assert "Training:" not in prompt
    assert "Next race:" not in prompt

    # Should be shorter than full profile
    full = "Experience: amateur. Target: 70.3. Goal: finish. Health notes: pain. Training: 10h/week. Next race: Sept."
    assert len(prompt) < len(full)


def test_format_profile_for_prompt_no_health_notes_when_none() -> None:
    """format_profile_for_prompt omits health notes when injuries is 'none'."""
    profile = AthleteProfile(
        user_id=uuid.uuid4(),
        sex="male",
        birth_year=1990,
        weight_kg=75.0,
        height_cm=180.0,
        injuries="none",
    )
    prompt = format_profile_for_prompt(profile)
    assert "Health notes:" not in prompt


def test_format_profile_for_prompt_with_goal_only() -> None:
    """format_profile_for_prompt with only target_distance includes goal section."""
    profile = AthleteProfile(
        user_id=uuid.uuid4(),
        sex="male",
        birth_year=1990,
        weight_kg=75.0,
        height_cm=180.0,
        injuries="none",
        target_distance="ironman",
    )
    prompt = format_profile_for_prompt(profile)
    assert "Target:" in prompt
    assert "Ironman" in prompt or "IRONMAN" in prompt or "ironman" in prompt.lower()
