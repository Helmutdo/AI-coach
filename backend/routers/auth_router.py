"""Garmin OAuth session and AI provider configuration."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from garminconnect import (
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
)
from pydantic import BaseModel, Field
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
from utils.encryption import ai_key_preview_from_stored, encrypt, get_plaintext_api_key

router = APIRouter(prefix="/auth", tags=["auth"])


class GarminLoginBody(BaseModel):
    email: str | None = Field(None, description="Overrides GARMIN_EMAIL from .env")
    password: str | None = Field(None, description="Overrides GARMIN_PASSWORD from .env")


class AIConfigureBody(BaseModel):
    provider: Literal["anthropic", "openai", "google"]
    api_key: str = Field(..., min_length=1)


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
def ai_status(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    row = get_or_create_user_settings(db, uuid.UUID(user_id))
    key_plain = get_plaintext_api_key(row.ai_api_key_encrypted)
    configured = bool(key_plain)
    return {
        "configured": configured,
        "provider": row.ai_provider if configured else None,
        "key_preview": ai_key_preview_from_stored(row.ai_api_key_encrypted) if configured else None,
    }


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
    return {
        "active": active,
        "oauth_tokens_present": tokens,
        "garmin_email": garmin_email if active else None,
    }


@router.post("/ai/configure")
def configure_ai(
    body: AIConfigureBody,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    provider = body.provider
    row = get_or_create_user_settings(db, uuid.UUID(user_id))
    row.ai_provider = provider
    try:
        row.ai_api_key_encrypted = encrypt(body.api_key.strip())
    except RuntimeError as e:
        raise HTTPException(
            status_code=500,
            detail=str(e) or "Encryption not configured (ENCRYPTION_KEY)",
        ) from e
    db.add(row)
    db.commit()
    preview = ai_key_preview_from_stored(row.ai_api_key_encrypted)
    return {"provider": provider, "key_preview": preview}


@router.delete("/ai/configure")
def clear_ai_configure(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, str]:
    row = get_or_create_user_settings(db, uuid.UUID(user_id))
    row.ai_api_key_encrypted = ""
    db.add(row)
    db.commit()
    return {"status": "ok"}


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
