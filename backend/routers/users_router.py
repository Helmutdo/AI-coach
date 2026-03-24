"""User registration / upsert (Google identity)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database.database import get_db
from dependencies.auth import get_current_user_id
from models.models import ChatMessage, DailyMetrics, GarminActivity, User

router = APIRouter(prefix="/users", tags=["users"])


class UserMeBody(BaseModel):
    google_id: str = Field(..., min_length=1, max_length=128)
    email: str = Field(..., min_length=1, max_length=512)
    name: str = Field("", max_length=512)
    avatar_url: str | None = Field(None, max_length=2048)


@router.post("/me")
def upsert_me(body: UserMeBody, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.query(User).filter(User.google_id == body.google_id).first()
    now = datetime.now(timezone.utc)
    if row:
        row.email = body.email
        row.name = body.name or row.name
        if body.avatar_url is not None:
            row.avatar_url = body.avatar_url
        row.updated_at = now
        db.add(row)
        db.commit()
        db.refresh(row)
    else:
        row = User(
            google_id=body.google_id,
            email=body.email,
            name=body.name or "",
            avatar_url=body.avatar_url,
        )
        db.add(row)
        db.commit()
        db.refresh(row)

    return {
        "id": str(row.id),
        "google_id": row.google_id,
        "email": row.email,
        "name": row.name,
        "avatar_url": row.avatar_url,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.delete("/me/data")
def delete_my_data(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    """Remove synced activities, daily metrics, and chat history for the current user."""
    uid = uuid.UUID(user_id)
    n_act = db.query(GarminActivity).filter(GarminActivity.user_id == uid).delete()
    n_day = db.query(DailyMetrics).filter(DailyMetrics.user_id == uid).delete()
    n_chat = db.query(ChatMessage).filter(ChatMessage.user_id == uid).delete()
    db.commit()
    return {
        "status": "ok",
        "deleted": {
            "activities": n_act,
            "daily_metrics": n_day,
            "chat_messages": n_chat,
        },
    }
