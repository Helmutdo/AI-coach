"""Garmin OAuth session and AI status endpoints."""

from __future__ import annotations

import os
import uuid
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from garminconnect import (
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
)
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from database.database import get_db
from dependencies.auth import get_current_user_id
from models.models import UserSettings
from services.garmin_service import (
    GarminService,
    clear_garmin_token_files,
    oauth_tokens_present,
    persist_garmin_tokens_encrypted,
    user_tokenstore,
)
from user_settings_service import get_or_create_user_settings

router = APIRouter(prefix="/auth", tags=["auth"])


class GarminLoginBody(BaseModel):
    email: str | None = Field(None, description="Overrides GARMIN_EMAIL from .env")
    password: str | None = Field(None, description="Overrides GARMIN_PASSWORD from .env")


@router.post("/garmin/login")
def garmin_login(
    request: Request,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
    body: GarminLoginBody | None = Body(default=None),
) -> dict[str, Any]:
    body = body or GarminLoginBody()
    uid = uuid.UUID(user_id)
    tokenstore = user_tokenstore(uid)
    try:
        svc = GarminService(
            tokenstore=tokenstore,
            email=body.email,
            password=body.password,
        )
        result = svc.login()
        profile = svc.get_user_profile()
        request.app.state.garmin_session_active = True
        try:
            persist_garmin_tokens_encrypted(db, uid, tokenstore)
        except RuntimeError as e:
            raise HTTPException(
                status_code=500,
                detail=str(e) or "Encryption not configured (ENCRYPTION_KEY)",
            ) from e
        row = get_or_create_user_settings(db, uid)
        em = (result.get("email") or "").strip() or (body.email or "").strip()
        if em:
            row.garmin_email = em
        db.add(row)
        db.commit()
        return {
            "status": result.get("status", "ok"),
            "email": result.get("email", ""),
            "profile": profile,
        }
    except GarminConnectAuthenticationError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    except GarminConnectConnectionError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.get("/ai/status")
def ai_status() -> dict[str, Any]:
    """Check whether the server-side OpenRouter API key is configured."""
    configured = bool((os.getenv("OPEN_ROUTER_APIKEY") or "").strip())
    model = (os.getenv("OPENROUTER_MODEL") or "openai/gpt-4o").strip() if configured else None
    return {"configured": configured, "model": model}


@router.get("/garmin/status")
def garmin_status(
    request: Request,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    uid = uuid.UUID(user_id)
    ts = user_tokenstore(uid)
    tokens_disk = oauth_tokens_present(ts)
    row = db.query(UserSettings).filter(UserSettings.user_id == uid).first()
    tokens_db = bool(row and row.garmin_token_encrypted)
    tokens = tokens_disk or tokens_db
    active = (
        bool(getattr(request.app.state, "garmin_session_active", False)) or tokens
    )
    garmin_email: str | None = None
    if row and (row.garmin_email or "").strip() not in (
        "",
        "not-configured@local",
    ):
        garmin_email = (row.garmin_email or "").strip()

    from models.models import GarminActivity as _GA
    count = (
        db.query(func.count(_GA.id))
        .filter(_GA.user_id == uid)
        .scalar()
        or 0
    )

    return {
        "active": active,
        "oauth_tokens_present": tokens,
        "garmin_email": garmin_email if active else None,
        "has_data": count > 0,
    }


@router.delete("/garmin/disconnect")
def garmin_disconnect(
    request: Request,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, str]:
    uid = uuid.UUID(user_id)
    row = get_or_create_user_settings(db, uid)
    row.garmin_token_encrypted = None
    row.garmin_email = "not-configured@local"
    db.add(row)
    db.commit()
    clear_garmin_token_files(user_tokenstore(uid))
    request.app.state.garmin_session_active = False
    return {"status": "ok"}
