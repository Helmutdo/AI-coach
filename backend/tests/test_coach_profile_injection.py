"""Tests for athlete profile injection into the AI coach system prompt."""

from __future__ import annotations

import uuid

from database.database import get_db
from models.models import AthleteProfile
from routers.coach_router import _athlete_profile_block


def _get_db_session():
    """Return a live DB session for test use."""
    gen = get_db()
    session = next(gen)
    return session, gen


def test_athlete_profile_block_no_profile():
    """Returns empty string when no profile exists for the user."""
    session, gen = _get_db_session()
    try:
        user_id = str(uuid.uuid4())
        result = _athlete_profile_block(session, user_id)
        assert result == ""
    finally:
        try:
            next(gen)
        except StopIteration:
            pass


def test_athlete_profile_block_with_profile():
    """Returns a non-empty string when a profile exists for the user."""
    session, gen = _get_db_session()
    try:
        uid = uuid.uuid4()
        profile = AthleteProfile(
            user_id=uid,
            sex="male",
            birth_year=1990,
            weight_kg=75.0,
            height_cm=180.0,
            injuries="none",
        )
        session.add(profile)
        session.commit()

        result = _athlete_profile_block(session, str(uid))
        assert result != ""
        assert "75.0kg" in result
        assert "180.0cm" in result

        # Clean up
        session.delete(profile)
        session.commit()
    finally:
        try:
            next(gen)
        except StopIteration:
            pass


def test_athlete_profile_block_invalid_uuid():
    """Returns empty string gracefully when user_id is not a valid UUID."""
    session, gen = _get_db_session()
    try:
        result = _athlete_profile_block(session, "not-a-uuid")
        assert result == ""
    finally:
        try:
            next(gen)
        except StopIteration:
            pass
