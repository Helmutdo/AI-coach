"""Unit tests for AICoachService (no live API calls)."""

from __future__ import annotations

from datetime import date, datetime, time

import pytest

from services.ai_service import AICoachService, _parse_analysis_result


def test_build_context_shapes():
    svc = AICoachService("test-key-openai", "openai")
    today = date.today()
    activities = [
        {
            "activity_type": "running",
            "activity_name": "Morning",
            "start_time": datetime.combine(today, time(7, 30)),
            "duration_seconds": 3600,
            "avg_heart_rate": 140,
            "training_load": 120.0,
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
    ctx = svc.build_context(activities, metrics)
    assert "RECENT ACTIVITIES" in ctx
    assert "running" in ctx
    assert "DAILY WELLNESS" in ctx
    assert "TRAINING LOAD TREND" in ctx


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
