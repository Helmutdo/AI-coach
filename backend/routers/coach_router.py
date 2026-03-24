"""AI coach chat and analysis."""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc
from sqlalchemy.orm import Session

from database.database import get_db
from dependencies.auth import get_current_user_id
from models.models import ChatMessage, DailyMetrics, GarminActivity
from orm_serializers import activity_to_dict, daily_metrics_to_dict
from services.ai_service import AICoachService
from user_settings_service import get_or_create_user_settings
from utils.encryption import get_plaintext_api_key

router = APIRouter(prefix="/coach", tags=["coach"])


class ChatBody(BaseModel):
    message: str = Field(..., min_length=1)
    conversation_id: str = Field(..., min_length=1, max_length=64)


def _make_ai_service(settings: Any) -> AICoachService:
    key = (get_plaintext_api_key(settings.ai_api_key_encrypted) or "").strip()
    if not key:
        raise HTTPException(
            status_code=400,
            detail="AI API key not configured — POST /api/auth/ai/configure",
        )
    try:
        return AICoachService(api_key=key, provider=settings.ai_provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


def _ai_failure_reply(exc: BaseException) -> tuple[str, bool]:
    """
    Returns (user-facing message, provider_error).
    provider_error=True when the key is likely invalid/unauthorized.
    """
    text = str(exc).lower()
    auth_like = (
        "401" in text
        or "403" in text
        or "invalid_api_key" in text
        or "incorrect api key" in text
        or "api_key_invalid" in text
        or "user_api_key" in text
        or "permission_denied" in text
        or ("authentication" in text and "fail" in text)
        or ("api key" in text and "invalid" in text)
    )
    if auth_like:
        return (
            "Could not connect to the AI provider: the API key appears invalid or expired. "
            "Update your key in Settings → AI provider.",
            True,
        )
    return (f"AI request failed: {exc}", False)


@router.post("/chat")
def coach_chat(
    body: ChatBody,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    uid = uuid.UUID(user_id)
    settings = get_or_create_user_settings(db, uid)
    ai = _make_ai_service(settings)

    acts = (
        db.query(GarminActivity)
        .filter(GarminActivity.user_id == uid)
        .order_by(desc(GarminActivity.start_time), desc(GarminActivity.id))
        .limit(20)
        .all()
    )
    metrics = (
        db.query(DailyMetrics)
        .filter(DailyMetrics.user_id == uid)
        .order_by(desc(DailyMetrics.date))
        .limit(30)
        .all()
    )
    act_dicts = [activity_to_dict(a) for a in acts]
    met_dicts = [daily_metrics_to_dict(m) for m in metrics]
    context = ai.build_context(act_dicts, met_dicts)

    prior = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.user_id == uid,
            ChatMessage.conversation_id == body.conversation_id,
        )
        .order_by(ChatMessage.created_at.asc())
        .all()
    )
    history = [{"role": m.role, "content": m.content} for m in prior]

    try:
        reply = ai.chat(body.message, context, history)
        provider_error = False
    except Exception as e:
        reply, provider_error = _ai_failure_reply(e)

    db.add(
        ChatMessage(
            user_id=uid,
            conversation_id=body.conversation_id,
            role="user",
            content=body.message,
            context_snapshot={
                "activities_loaded": len(act_dicts),
                "metrics_loaded": len(met_dicts),
            },
        )
    )
    db.add(
        ChatMessage(
            user_id=uid,
            conversation_id=body.conversation_id,
            role="assistant",
            content=reply,
            context_snapshot={"provider_error": provider_error} if provider_error else None,
        )
    )
    db.commit()

    return {
        "response": reply,
        "conversation_id": body.conversation_id,
        "provider_error": provider_error,
    }


@router.get("/analysis")
def coach_analysis(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    uid = uuid.UUID(user_id)
    settings = get_or_create_user_settings(db, uid)
    ai = _make_ai_service(settings)

    start = date.today() - timedelta(days=29)
    metrics = (
        db.query(DailyMetrics)
        .filter(DailyMetrics.user_id == uid, DailyMetrics.date >= start)
        .order_by(DailyMetrics.date.asc())
        .all()
    )
    acts = (
        db.query(GarminActivity)
        .filter(GarminActivity.user_id == uid)
        .order_by(desc(GarminActivity.start_time))
        .limit(200)
        .all()
    )

    act_dicts = [activity_to_dict(a) for a in acts]
    met_dicts = [daily_metrics_to_dict(m) for m in metrics]

    try:
        return ai.analyze_training_load(act_dicts, met_dicts)
    except Exception as e:
        msg, _ = _ai_failure_reply(e)
        raise HTTPException(status_code=502, detail=msg) from e


@router.get("/history")
def coach_history(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> list[dict[str, Any]]:
    uid = uuid.UUID(user_id)
    rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.user_id == uid)
        .order_by(desc(ChatMessage.created_at))
        .limit(50)
        .all()
    )
    out: list[dict[str, Any]] = []
    for m in rows:
        out.append(
            {
                "id": m.id,
                "conversation_id": m.conversation_id,
                "role": m.role,
                "content": m.content,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
        )
    return out
