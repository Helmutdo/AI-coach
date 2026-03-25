"""Helpers for per-user UserSettings rows."""

from __future__ import annotations

import logging
import os
import uuid

from sqlalchemy.orm import Session

from models.models import UserSettings

logger = logging.getLogger(__name__)


def get_or_create_user_settings(db: Session, user_id: uuid.UUID) -> UserSettings:
    row = db.query(UserSettings).filter(UserSettings.user_id == user_id).first()
    if row:
        return row
    env_key = (
        os.getenv("ANTHROPIC_API_KEY", "")
        or os.getenv("OPENAI_API_KEY", "")
        or os.getenv("GOOGLE_API_KEY", "")
    ).strip()
    row = UserSettings(
        user_id=user_id,
        garmin_email=os.getenv("GARMIN_EMAIL", "not-configured@local").strip() or "not-configured@local",
        ai_provider=os.getenv("AI_PROVIDER", "anthropic").strip() or "anthropic",
        ai_api_key_encrypted="",
    )
    if env_key:
        from utils.encryption import encrypt

        try:
            row.ai_api_key_encrypted = encrypt(env_key)
        except RuntimeError:
            logger.warning(
                "ENCRYPTION_KEY not set — env AI key will not be stored for new user %s. "
                "Set ENCRYPTION_KEY and re-register to persist the key.",
                user_id,
            )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
