"""Garmin OAuth session and AI provider configuration."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from garminconnect import (
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
)
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database.database import get_db
from services.garmin_service import DEFAULT_TOKENSTORE, GarminService
from user_settings_service import get_or_create_user_settings

router = APIRouter(prefix="/auth", tags=["auth"])


class GarminLoginBody(BaseModel):
    email: str | None = Field(None, description="Overrides GARMIN_EMAIL from .env")
    password: str | None = Field(None, description="Overrides GARMIN_PASSWORD from .env")


class AIConfigureBody(BaseModel):
    provider: Literal["anthropic", "openai", "google"]
    api_key: str = Field(..., min_length=1)


def _oauth_files_present() -> bool:
    p = DEFAULT_TOKENSTORE.expanduser().resolve()
    return (
        p.is_dir()
        and (p / "oauth1_token.json").is_file()
        and (p / "oauth2_token.json").is_file()
    )


@router.post("/garmin/login")
def garmin_login(
    request: Request,
    body: GarminLoginBody | None = Body(default=None),
) -> dict[str, Any]:
    body = body or GarminLoginBody()
    try:
        svc = GarminService(
            email=body.email,
            password=body.password,
        )
        result = svc.login()
        profile = svc.get_user_profile()
        request.app.state.garmin_session_active = True
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
def ai_status(db: Session = Depends(get_db)) -> dict[str, Any]:
    row = get_or_create_user_settings(db)
    key = (row.ai_api_key or "").strip()
    configured = bool(key and key != "unset")
    return {
        "configured": configured,
        "provider": row.ai_provider if configured else None,
    }


@router.get("/garmin/status")
def garmin_status(request: Request) -> dict[str, Any]:
    tokens = _oauth_files_present()
    active = bool(getattr(request.app.state, "garmin_session_active", False)) or tokens
    return {
        "active": active,
        "oauth_tokens_present": tokens,
    }


@router.post("/ai/configure")
def configure_ai(body: AIConfigureBody, db: Session = Depends(get_db)) -> dict[str, Any]:
    provider = body.provider
    row = get_or_create_user_settings(db)
    row.ai_provider = provider
    row.ai_api_key = body.api_key.strip()
    db.add(row)
    db.commit()
    return {"status": "ok", "provider": provider}
