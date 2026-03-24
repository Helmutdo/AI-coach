"""Helpers for the singleton UserSettings row."""

from __future__ import annotations

import os

from sqlalchemy.orm import Session

from models.models import UserSettings


def get_or_create_user_settings(db: Session) -> UserSettings:
    row = db.query(UserSettings).first()
    if row:
        return row
    row = UserSettings(
        garmin_email=os.getenv("GARMIN_EMAIL", "not-configured@local").strip() or "not-configured@local",
        ai_provider=os.getenv("AI_PROVIDER", "anthropic").strip() or "anthropic",
        ai_api_key=(
            os.getenv("ANTHROPIC_API_KEY", "")
            or os.getenv("OPENAI_API_KEY", "")
            or os.getenv("GOOGLE_API_KEY", "")
            or "unset"
        ),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
