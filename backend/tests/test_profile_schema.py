"""Tests for AthleteProfile Pydantic schemas."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from schemas.profile_schema import AthleteProfileIn, AthleteProfileOut


MINIMAL_VALID = {
    "sex": "male",
    "birth_year": 1990,
    "weight_kg": 72.0,
    "height_cm": 178.0,
    "injuries": "none",
}


def test_valid_minimal():
    p = AthleteProfileIn(**MINIMAL_VALID)
    assert p.sex == "male"
    assert p.injuries == "none"


def test_valid_full():
    p = AthleteProfileIn(
        **MINIMAL_VALID,
        hours_per_week=10.0,
        experience="amateur",
        years_in_triathlon=5,
        target_distance="70.3",
        primary_goal="finish",
        next_race_date="September 2026",
    )
    assert p.target_distance == "70.3"
    assert p.experience == "amateur"


def test_invalid_sex():
    with pytest.raises(ValidationError):
        AthleteProfileIn(**{**MINIMAL_VALID, "sex": "unknown"})


def test_invalid_birth_year_too_old():
    with pytest.raises(ValidationError):
        AthleteProfileIn(**{**MINIMAL_VALID, "birth_year": 1800})


def test_invalid_birth_year_too_young():
    with pytest.raises(ValidationError):
        AthleteProfileIn(**{**MINIMAL_VALID, "birth_year": 2025})


def test_invalid_experience():
    with pytest.raises(ValidationError):
        AthleteProfileIn(**{**MINIMAL_VALID, "experience": "elite"})


def test_invalid_target_distance():
    with pytest.raises(ValidationError):
        AthleteProfileIn(**{**MINIMAL_VALID, "target_distance": "full"})


def test_out_from_attributes():
    class FakeRow:
        sex = "female"
        birth_year = 1985
        weight_kg = 58.0
        height_cm = 165.0
        injuries = "mild knee"
        hours_per_week = 8.0
        experience = "competitive"
        years_in_triathlon = 10
        target_distance = "ironman"
        primary_goal = "time_goal"
        next_race_date = "June 2027"

    p = AthleteProfileOut.model_validate(FakeRow(), from_attributes=True)
    assert p.sex == "female"
    assert p.target_distance == "ironman"
