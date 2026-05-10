"""Strava OAuth 2.0, sync, and cached activities."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)
limiter = Limiter(key_func=get_remote_address)

from database.database import get_db
from dependencies.auth import get_current_user_id
from models.models import StravaActivity, UserSettings
from services.strava_service import StravaService, frontend_redirect_after_oauth, strava_oauth_configured
from user_settings_service import get_or_create_user_settings
from utils.encryption import encrypt

router = APIRouter(prefix="/strava", tags=["strava"])

_svc = StravaService()


def _settings_redirect_url() -> str:
    """Full URL to frontend /settings (STRAVA_FRONTEND_REDIRECT or default)."""
    return frontend_redirect_after_oauth().strip()


def _append_query(url: str, params: dict[str, str]) -> str:
    parts = urlparse(url)
    merged = dict(parse_qsl(parts.query, keep_blank_values=True))
    merged.update(params)
    new_query = urlencode(merged)
    return urlunparse(
        (parts.scheme, parts.netloc, parts.path, parts.params, new_query, parts.fragment)
    )


class StravaSyncBody(BaseModel):
    days_back: int = Field(60, ge=1, le=365)


def _serialize_activity(row: StravaActivity) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "user_id": str(row.user_id),
        "strava_id": row.strava_id,
        "name": row.name,
        "sport_type": row.sport_type,
        "start_date": row.start_date.isoformat() if row.start_date else None,
        "elapsed_time": row.elapsed_time,
        "distance": row.distance,
        "moving_time": row.moving_time,
        "total_elevation_gain": row.total_elevation_gain,
        "avg_heartrate": row.avg_heartrate,
        "max_heartrate": row.max_heartrate,
        "avg_watts": row.avg_watts,
        "weighted_avg_watts": row.weighted_avg_watts,
        "suffer_score": row.suffer_score,
        "avg_cadence": row.avg_cadence,
        "avg_speed": row.avg_speed,
        "pr_count": row.pr_count,
        "achievement_count": row.achievement_count,
        "kudos_count": row.kudos_count,
        "map_polyline": row.map_polyline,
        "synced_at": row.synced_at.isoformat() if row.synced_at else None,
    }


@router.get("/connect")
def strava_connect(
    user_id: str = Depends(get_current_user_id),
) -> dict[str, str]:
    if not strava_oauth_configured():
        raise HTTPException(
            status_code=503,
            detail="Strava OAuth is not configured (STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REDIRECT_URI)",
        )
    return {"auth_url": _svc.get_authorization_url(user_id)}


@router.get("/callback")
def strava_callback(
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """OAuth redirect target — no X-User-Id; user id is in `state`."""
    base = _settings_redirect_url()
    if error:
        return RedirectResponse(
            url=_append_query(base, {"strava_error": "access_denied"}),
            status_code=302,
        )
    if not code or not state:
        return RedirectResponse(
            url=_append_query(base, {"strava_error": "missing_code_or_state"}),
            status_code=302,
        )
    try:
        uid = uuid.UUID(state.strip())
    except ValueError:
        return RedirectResponse(
            url=_append_query(base, {"strava_error": "invalid_state"}),
            status_code=302,
        )

    if not strava_oauth_configured():
        return RedirectResponse(
            url=_append_query(base, {"strava_error": "server_misconfigured"}),
            status_code=302,
        )

    try:
        token_payload = _svc.exchange_code(code)
    except RuntimeError as e:
        return RedirectResponse(
            url=_append_query(base, {"strava_error": str(e)[:500]}),
            status_code=302,
        )

    access = token_payload.get("access_token")
    if not access or not isinstance(access, str):
        return RedirectResponse(
            url=_append_query(base, {"strava_error": "no_access_token"}),
            status_code=302,
        )
    refresh = token_payload.get("refresh_token")
    refresh_s = refresh if isinstance(refresh, str) else None
    expires_at = token_payload.get("expires_at")
    expires_i = int(expires_at) if isinstance(expires_at, (int, float)) else None

    try:
        enc_a = encrypt(access)
        enc_r = encrypt(refresh_s) if refresh_s else None
    except RuntimeError:
        return RedirectResponse(
            url=_append_query(base, {"strava_error": "encryption_not_configured"}),
            status_code=302,
        )

    athlete: dict[str, Any] = {}
    if isinstance(token_payload.get("athlete"), dict):
        athlete = token_payload["athlete"]
    else:
        try:
            athlete = _svc.fetch_athlete(access)
        except RuntimeError as e:
            logger.warning("Could not fetch Strava athlete profile: %s", e)
            athlete = {}

    aid = athlete.get("id")
    first = (athlete.get("firstname") or "").strip()
    last = (athlete.get("lastname") or "").strip()
    name = f"{first} {last}".strip() or None

    row = get_or_create_user_settings(db, uid)
    row.strava_access_token_encrypted = enc_a
    row.strava_refresh_token_encrypted = enc_r
    row.strava_token_expires_at = expires_i
    row.strava_athlete_id = str(aid) if aid is not None else None
    row.strava_athlete_name = name
    row.strava_connected = True
    db.add(row)
    db.commit()

    return RedirectResponse(
        url=_append_query(base, {"strava_connected": "true"}),
        status_code=302,
    )


@router.get("/status")
def strava_status(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    uid = uuid.UUID(user_id)
    row = db.query(UserSettings).filter(UserSettings.user_id == uid).first()
    last_sync: datetime | None = db.query(func.max(StravaActivity.synced_at)).filter(
        StravaActivity.user_id == uid
    ).scalar()
    activity_count = (
        db.query(func.count(StravaActivity.id)).filter(StravaActivity.user_id == uid).scalar()
        or 0
    )

    oauth_ok = strava_oauth_configured()
    if not row:
        return {
            "connected": False,
            "athlete_name": None,
            "athlete_id": None,
            "last_sync": None,
            "activity_count": int(activity_count),
            "oauth_configured": oauth_ok,
        }

    return {
        "connected": bool(row.strava_connected),
        "athlete_name": row.strava_athlete_name,
        "athlete_id": row.strava_athlete_id,
        "last_sync": last_sync.isoformat() if last_sync else None,
        "activity_count": int(activity_count),
        "oauth_configured": oauth_ok,
    }


@router.post("/sync")
@limiter.limit("5/minute")
def strava_sync(
    request: Request,
    body: StravaSyncBody,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return _svc.sync_activities(user_id, db, body.days_back)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/activities")
def strava_activities(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
    limit: int = Query(100, ge=1, le=5000),
    days: int = Query(30, ge=0, le=3650),
    sport_type: str | None = Query(None),
) -> list[dict[str, Any]]:
    from datetime import timedelta, timezone
    uid = uuid.UUID(user_id)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    q = db.query(StravaActivity).filter(
        StravaActivity.user_id == uid,
        StravaActivity.start_date >= cutoff,
    )
    if sport_type is not None and sport_type.strip():
        q = q.filter(StravaActivity.sport_type == sport_type.strip())
    rows = q.order_by(StravaActivity.start_date.desc()).limit(limit).all()
    return [_serialize_activity(r) for r in rows]


@router.delete("/disconnect")
def strava_disconnect(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, str]:
    _svc.disconnect(user_id, db)
    return {"status": "disconnected"}
