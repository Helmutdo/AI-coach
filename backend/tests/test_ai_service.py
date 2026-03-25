"""Unit tests for AICoachService (no live API calls)."""

from __future__ import annotations

from datetime import date, datetime, time

import pytest

from services.ai_service import AICoachService, _parse_analysis_result


def test_build_context_shapes():
    svc = AICoachService("test-key-openai", "openai")
    today = date.today()
    garmin_activities = [
        {
            "activity_type": "running",
            "activity_name": "Morning",
            "start_time": datetime.combine(today, time(7, 30)),
            "duration_seconds": 3600,
            "avg_heart_rate": 140,
            "training_load": 120.0,
            "aerobic_effect": 3.2,
            "distance_meters": 10000,
        }
    ]
    strava_activities = [
        {
            "sport_type": "Ride",
            "start_time": datetime.combine(today, time(8, 0)),
            "moving_time": 1800,
            "distance": 15000,
            "avg_heartrate": 130.0,
            "suffer_score": 45,
        }
    ]
    metrics = [
        {
            "date": today,
            "sleep_score": 80,
            "hrv_status": "balanced",
            "avg_stress": 30,
            "body_battery_min": 20,
            "body_battery_max": 85,
            "steps": 10000,
            "resting_heart_rate": 48,
        }
    ]
    ctx = svc.build_context(
        garmin_activities=garmin_activities,
        garmin_metrics=metrics,
        strava_activities=strava_activities,
        garmin_connected=True,
        strava_connected=True,
        strava_athlete_name="Test Athlete",
    )
    assert "ATHLETE DATA SOURCES" in ctx
    assert "Garmin ✓" in ctx
    assert "Strava ✓ as Test Athlete" in ctx
    assert "RECENT ACTIVITIES" in ctx
    assert "[Garmin]" in ctx or "[Strava]" in ctx
    assert "DAILY HEALTH METRICS" in ctx
    assert "WEEKLY LOAD SUMMARY" in ctx
    assert "NOTABLE PATTERNS" in ctx


def test_provider_invalid():
    with pytest.raises(ValueError, match="Unsupported"):
        AICoachService("k", "azure")


def test_google_provider_inits():
    svc = AICoachService("test-google-key", "google")
    assert svc.provider == "google"


def test_parse_analysis_result():
    raw = '{"overall_status": "ok", "fatigue_level": 3, "readiness_score": 8, "key_observations": ["a"], "recommendations": ["b"]}'
    d = _parse_analysis_result(raw)
    assert d["overall_status"] == "ok"
    assert d["fatigue_level"] == 3
    assert d["readiness_score"] == 8


def test_init_requires_key():
    with pytest.raises(ValueError):
        AICoachService("", "anthropic")
