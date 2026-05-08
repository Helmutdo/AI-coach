"""AI coach chat and analysis."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import desc
from sqlalchemy.orm import Session

from database.database import get_db
from dependencies.auth import get_current_user_id
from models.models import AthleteProfile, ChatMessage, DailyMetrics, GarminActivity, StravaActivity
from routers.profile_router import format_profile_for_prompt
from orm_serializers import (
    activity_to_dict,
    daily_metrics_to_dict,
    strava_activity_to_dict,
)
from services.ai_service import AICoachService
from user_settings_service import get_or_create_user_settings

router = APIRouter(prefix="/coach", tags=["coach"])
limiter = Limiter(key_func=get_remote_address)


class ChatBody(BaseModel):
    message: str = Field(..., min_length=1)
    conversation_id: str = Field(..., min_length=1, max_length=64)


def _get_ai_service() -> AICoachService:
    try:
        return AICoachService()
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


def _ai_failure_reply(exc: BaseException) -> tuple[str, bool]:
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
            "Could not connect to the AI provider: the API key appears invalid or expired.",
            True,
        )
    return (f"AI request failed: {exc}", False)


def _fetch_recent_context(
    db: Session, uid: uuid.UUID, days: int = 7, act_limit: int = 20
) -> tuple[list[Any], list[Any], DailyMetrics | None]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    acts = (
        db.query(GarminActivity)
        .filter(
            GarminActivity.user_id == uid,
            GarminActivity.start_time.isnot(None),
            GarminActivity.start_time >= cutoff,
        )
        .order_by(desc(GarminActivity.start_time))
        .limit(act_limit)
        .all()
    )
    strava_rows = (
        db.query(StravaActivity)
        .filter(
            StravaActivity.user_id == uid,
            StravaActivity.start_date >= cutoff,
        )
        .order_by(desc(StravaActivity.start_date))
        .limit(act_limit)
        .all()
    )
    today_metric = (
        db.query(DailyMetrics)
        .filter(DailyMetrics.user_id == uid)
        .order_by(desc(DailyMetrics.date))
        .first()
    )
    return acts, strava_rows, today_metric


def _integration_flags(settings: Any) -> tuple[bool, bool, str | None]:
    garmin_connected = bool(getattr(settings, "garmin_token_encrypted", None))
    strava_connected = bool(getattr(settings, "strava_connected", False))
    raw_name = getattr(settings, "strava_athlete_name", None)
    strava_name = (str(raw_name).strip() if raw_name else "") or None
    return garmin_connected, strava_connected, strava_name


def _athlete_profile_block(db: Session, user_id: str) -> str:
    """Return formatted profile string or empty string if no profile set."""
    try:
        uid = uuid.UUID(user_id)
        profile = db.query(AthleteProfile).filter(AthleteProfile.user_id == uid).first()
        if profile:
            return format_profile_for_prompt(profile)
    except Exception:
        pass
    return ""


@router.post("/chat")
@limiter.limit("20/minute")
def coach_chat(
    request: Request,
    body: ChatBody,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    uid = uuid.UUID(user_id)
    settings = get_or_create_user_settings(db, uid)
    ai = _get_ai_service()

    garmin_connected, strava_connected, strava_athlete_name = _integration_flags(settings)

    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    acts = (
        db.query(GarminActivity)
        .filter(
            GarminActivity.user_id == uid,
            GarminActivity.start_time.isnot(None),
            GarminActivity.start_time >= cutoff,
        )
        .order_by(desc(GarminActivity.start_time), desc(GarminActivity.id))
        .limit(100)
        .all()
    )
    strava_rows = (
        db.query(StravaActivity)
        .filter(
            StravaActivity.user_id == uid,
            StravaActivity.start_date >= cutoff,
        )
        .order_by(desc(StravaActivity.start_date))
        .limit(100)
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
    strava_dicts = [strava_activity_to_dict(a) for a in strava_rows]
    met_dicts = [daily_metrics_to_dict(m) for m in metrics]
    context = ai.build_context(
        garmin_activities=act_dicts,
        garmin_metrics=met_dicts,
        strava_activities=strava_dicts,
        garmin_connected=garmin_connected,
        strava_connected=strava_connected,
        strava_athlete_name=strava_athlete_name,
    )

    # Load the last 50 messages to avoid unbounded LLM context on long conversations.
    recent = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.user_id == uid,
            ChatMessage.conversation_id == body.conversation_id,
        )
        .order_by(ChatMessage.created_at.desc())
        .limit(50)
        .all()
    )
    history = [{"role": m.role, "content": m.content} for m in reversed(recent)]

    profile_block = _athlete_profile_block(db, user_id)
    if profile_block:
        context = f"{profile_block}\n\n{context}"

    try:
        reply = ai.chat(
            body.message,
            context,
            history,
            user_id=user_id,
            conversation_id=body.conversation_id,
        )
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
                "garmin_activities_loaded": len(act_dicts),
                "strava_activities_loaded": len(strava_dicts),
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
@limiter.limit("10/minute")
def coach_analysis(
    request: Request,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    uid = uuid.UUID(user_id)
    settings = get_or_create_user_settings(db, uid)
    ai = _get_ai_service()

    garmin_connected, strava_connected, strava_athlete_name = _integration_flags(settings)

    start = date.today() - timedelta(days=29)
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    metrics = (
        db.query(DailyMetrics)
        .filter(DailyMetrics.user_id == uid, DailyMetrics.date >= start)
        .order_by(DailyMetrics.date.asc())
        .all()
    )
    acts = (
        db.query(GarminActivity)
        .filter(
            GarminActivity.user_id == uid,
            GarminActivity.start_time.isnot(None),
            GarminActivity.start_time >= cutoff,
        )
        .order_by(desc(GarminActivity.start_time))
        .limit(100)
        .all()
    )
    strava_rows = (
        db.query(StravaActivity)
        .filter(
            StravaActivity.user_id == uid,
            StravaActivity.start_date >= cutoff,
        )
        .order_by(desc(StravaActivity.start_date))
        .limit(100)
        .all()
    )

    act_dicts = [activity_to_dict(a) for a in acts]
    strava_dicts = [strava_activity_to_dict(a) for a in strava_rows]
    met_dicts = [daily_metrics_to_dict(m) for m in metrics]

    try:
        return ai.analyze_training_load(
            garmin_activities=act_dicts,
            garmin_metrics=met_dicts,
            strava_activities=strava_dicts,
            garmin_connected=garmin_connected,
            strava_connected=strava_connected,
            strava_athlete_name=strava_athlete_name,
            user_id=user_id,
        )
    except Exception as e:
        msg, _ = _ai_failure_reply(e)
        raise HTTPException(status_code=502, detail=msg) from e


@router.get("/daily-brief")
@limiter.limit("10/minute")
def coach_daily_brief(
    request: Request,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, str]:
    """Generate a personalized daily training brief with status classification."""
    uid = uuid.UUID(user_id)
    settings = get_or_create_user_settings(db, uid)
    ai = _get_ai_service()

    garmin_connected, strava_connected, strava_athlete_name = _integration_flags(settings)

    acts, strava_rows, today_metric = _fetch_recent_context(db, uid)
    act_dicts = [activity_to_dict(a) for a in acts]
    strava_dicts = [strava_activity_to_dict(a) for a in strava_rows]
    met_dicts = [daily_metrics_to_dict(today_metric)] if today_metric else []

    status = "base"
    if today_metric:
        hrv = getattr(today_metric, "hrv_status", None)
        body_min = getattr(today_metric, "body_battery_min", None)
        sleep_score = getattr(today_metric, "sleep_score", None)
        if hrv in ("Low", "Poor", "Unbalanced") or (body_min is not None and body_min < 20):
            status = "recovery"
        elif sleep_score is not None and sleep_score > 80:
            recent_load = sum((a.training_load or 0) for a in acts[:2])
            status = "peak" if recent_load < 50 else "quality"
    if status == "base":
        recent_load = sum((a.training_load or 0) for a in acts[:2])
        if recent_load > 150:
            status = "recovery"
        elif recent_load > 80:
            status = "quality"

    context = ai.build_context(
        garmin_activities=act_dicts,
        garmin_metrics=met_dicts,
        strava_activities=strava_dicts,
        garmin_connected=garmin_connected,
        strava_connected=strava_connected,
        strava_athlete_name=strava_athlete_name,
    )

    brief_prompt = (
        "Generate a 2-sentence daily training brief for a triathlete. "
        "First sentence: today's recommended focus based on the data. "
        "Second sentence: one specific data-driven insight from their metrics. "
        "Be direct and specific. No fluff. No greetings. Max 50 words total."
    )

    try:
        brief = ai.chat(brief_prompt, context, [], user_id=user_id)
    except Exception as e:
        msg, _ = _ai_failure_reply(e)
        raise HTTPException(status_code=502, detail=msg) from e

    return {"brief": brief, "status": status}


@router.get("/greeting")
@limiter.limit("10/minute")
def coach_greeting(
    request: Request,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, str]:
    """Generate an ephemeral personalized greeting for the coach page."""
    uid = uuid.UUID(user_id)
    settings = get_or_create_user_settings(db, uid)
    ai = _get_ai_service()

    garmin_connected, strava_connected, strava_athlete_name = _integration_flags(settings)

    acts, strava_rows, today_metric = _fetch_recent_context(db, uid)
    act_dicts = [activity_to_dict(a) for a in acts]
    strava_dicts = [strava_activity_to_dict(a) for a in strava_rows]
    met_dicts = [daily_metrics_to_dict(today_metric)] if today_metric else []

    context = ai.build_context(
        garmin_activities=act_dicts,
        garmin_metrics=met_dicts,
        strava_activities=strava_dicts,
        garmin_connected=garmin_connected,
        strava_connected=strava_connected,
        strava_athlete_name=strava_athlete_name,
    )

    greeting_prompt = (
        "Generate a short, friendly greeting (2-3 sentences max) for a triathlete "
        "opening their coaching app. Reference 1-2 specific data points from their "
        "recent training if available. End with one open question to start the conversation. "
        "Be warm and encouraging. Do not use markdown formatting."
    )

    try:
        message = ai.chat(greeting_prompt, context, [], user_id=user_id)
    except Exception as e:
        msg, _ = _ai_failure_reply(e)
        raise HTTPException(status_code=502, detail=msg) from e

    return {"message": message}


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
