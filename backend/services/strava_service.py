"""Strava OAuth 2.0 and REST API (httpx only).

# Strava Developer Setup (one time):
# 1. Go to https://www.strava.com/settings/api
# 2. Create an app — name: "Garmin AI Coach", website: your Vercel URL
# 3. Authorization Callback Domain: your Railway domain (e.g. garmin-trainer-production.up.railway.app)
# 4. Copy Client ID and Client Secret to your .env
#
# Environment (backend .env and Railway):
#   STRAVA_CLIENT_ID=
#   STRAVA_CLIENT_SECRET=
#   STRAVA_REDIRECT_URI=https://your-railway-url.up.railway.app/api/strava/callback
# Optional: STRAVA_FRONTEND_REDIRECT — browser redirect after successful OAuth
"""

from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
from sqlalchemy.orm import Session, object_session

from models.models import StravaActivity, UserSettings
from utils.encryption import decrypt, encrypt

STRAVA_BASE = "https://www.strava.com/api/v3"
STRAVA_AUTH = "https://www.strava.com/oauth"


def frontend_redirect_after_oauth() -> str:
    return (os.getenv("STRAVA_FRONTEND_REDIRECT") or "http://localhost:3000/settings").strip()


def _http_error_message(exc: httpx.HTTPStatusError) -> str:
    body = ""
    try:
        body = (exc.response.text or "")[:500]
    except Exception:
        pass
    return f"Strava HTTP {exc.response.status_code}: {body or exc.response.reason_phrase}"


def _request_error_message(exc: httpx.RequestError) -> str:
    return f"Strava request failed: {type(exc).__name__}: {exc}"


class StravaService:
    STRAVA_BASE = STRAVA_BASE
    STRAVA_AUTH = STRAVA_AUTH

    def __init__(self, timeout: float = 30.0) -> None:
        self._timeout = timeout

    @staticmethod
    def oauth_configured() -> bool:
        cid = (os.getenv("STRAVA_CLIENT_ID") or "").strip()
        secret = (os.getenv("STRAVA_CLIENT_SECRET") or "").strip()
        redirect = (os.getenv("STRAVA_REDIRECT_URI") or "").strip()
        return bool(cid and secret and redirect)

    def _client(self) -> httpx.Client:
        return httpx.Client(timeout=self._timeout)

    def get_authorization_url(self, user_id: str) -> str:
        cid = (os.getenv("STRAVA_CLIENT_ID") or "").strip()
        ruri = (os.getenv("STRAVA_REDIRECT_URI") or "").strip()
        q = urlencode(
            {
                "client_id": cid,
                "redirect_uri": ruri,
                "response_type": "code",
                "approval_prompt": "auto",
                "scope": "read,activity:read_all",
                "state": user_id,
            }
        )
        return f"{STRAVA_AUTH}/authorize?{q}"

    def exchange_code(self, code: str) -> dict[str, Any]:
        """POST /oauth/token (authorization_code). Returns token JSON including athlete."""
        cid = (os.getenv("STRAVA_CLIENT_ID") or "").strip()
        secret = (os.getenv("STRAVA_CLIENT_SECRET") or "").strip()
        url = f"{STRAVA_AUTH}/token"
        try:
            with self._client() as client:
                r = client.post(
                    url,
                    data={
                        "client_id": cid,
                        "client_secret": secret,
                        "code": code,
                        "grant_type": "authorization_code",
                    },
                )
                r.raise_for_status()
                return r.json()
        except httpx.HTTPStatusError as e:
            raise RuntimeError(_http_error_message(e)) from e
        except httpx.RequestError as e:
            raise RuntimeError(_request_error_message(e)) from e

    def refresh_token_if_needed(self, user_settings: UserSettings) -> str:
        """
        Return a valid decrypted access token; refresh if expiring within 5 minutes.
        Persists new tokens on user_settings via its Session.
        """
        sess = object_session(user_settings)
        if sess is None:
            raise RuntimeError("user_settings must be bound to a SQLAlchemy Session")

        now = int(time.time())
        exp = user_settings.strava_token_expires_at
        needs_refresh = exp is None or exp < now + 300

        access_plain = (decrypt(user_settings.strava_access_token_encrypted or "") or "").strip()
        refresh_enc = user_settings.strava_refresh_token_encrypted
        refresh_plain = (decrypt(refresh_enc) or "").strip() if refresh_enc else None
        if refresh_plain == "":
            refresh_plain = None

        if not needs_refresh and access_plain:
            return access_plain

        if not refresh_plain:
            raise RuntimeError(
                "Strava refresh token missing or invalid — reconnect Strava in settings"
            )

        cid = (os.getenv("STRAVA_CLIENT_ID") or "").strip()
        secret = (os.getenv("STRAVA_CLIENT_SECRET") or "").strip()
        url = f"{STRAVA_AUTH}/token"
        try:
            with self._client() as client:
                r = client.post(
                    url,
                    data={
                        "client_id": cid,
                        "client_secret": secret,
                        "grant_type": "refresh_token",
                        "refresh_token": refresh_plain,
                    },
                )
                r.raise_for_status()
                data = r.json()
        except httpx.HTTPStatusError as e:
            raise RuntimeError(_http_error_message(e)) from e
        except httpx.RequestError as e:
            raise RuntimeError(_request_error_message(e)) from e

        new_access = data.get("access_token")
        if not isinstance(new_access, str) or not new_access:
            raise RuntimeError("Strava refresh response missing access_token")

        new_refresh = data.get("refresh_token")
        new_refresh_s = new_refresh if isinstance(new_refresh, str) else refresh_plain

        try:
            user_settings.strava_access_token_encrypted = encrypt(new_access)
            user_settings.strava_refresh_token_encrypted = (
                encrypt(new_refresh_s) if new_refresh_s else None
            )
            ex = data.get("expires_at")
            user_settings.strava_token_expires_at = (
                int(ex) if isinstance(ex, (int, float)) else None
            )
        except RuntimeError as e:
            raise RuntimeError(str(e) or "ENCRYPTION_KEY not configured") from e

        sess.add(user_settings)
        sess.commit()
        return new_access

    def get_athlete_activities(
        self,
        access_token: str,
        after_timestamp: int | None = None,
        limit: int = 100,
        page: int = 1,
    ) -> list[Any]:
        per_page = min(max(limit, 1), 100)
        params: dict[str, Any] = {"per_page": per_page, "page": page}
        if after_timestamp is not None:
            params["after"] = int(after_timestamp)
        url = f"{STRAVA_BASE}/athlete/activities"
        try:
            with self._client() as client:
                r = client.get(
                    url,
                    headers={"Authorization": f"Bearer {access_token}"},
                    params=params,
                )
                r.raise_for_status()
                out = r.json()
        except httpx.HTTPStatusError as e:
            raise RuntimeError(_http_error_message(e)) from e
        except httpx.RequestError as e:
            raise RuntimeError(_request_error_message(e)) from e

        if isinstance(out, list):
            return out
        return []

    def get_activity_detail(self, access_token: str, activity_id: int) -> dict[str, Any]:
        url = f"{STRAVA_BASE}/activities/{int(activity_id)}"
        try:
            with self._client() as client:
                r = client.get(
                    url,
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"include_all_efforts": "false"},
                )
                r.raise_for_status()
                return r.json()
        except httpx.HTTPStatusError as e:
            raise RuntimeError(_http_error_message(e)) from e
        except httpx.RequestError as e:
            raise RuntimeError(_request_error_message(e)) from e

    def fetch_athlete(self, access_token: str) -> dict[str, Any]:
        url = f"{STRAVA_BASE}/athlete"
        try:
            with self._client() as client:
                r = client.get(
                    url,
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                r.raise_for_status()
                return r.json()
        except httpx.HTTPStatusError as e:
            raise RuntimeError(_http_error_message(e)) from e
        except httpx.RequestError as e:
            raise RuntimeError(_request_error_message(e)) from e

    @staticmethod
    def _parse_start_date(raw: Any) -> datetime:
        if isinstance(raw, datetime):
            if raw.tzinfo is None:
                return raw.replace(tzinfo=timezone.utc)
            return raw
        if not raw:
            return datetime.now(timezone.utc)
        s = str(raw)
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            return datetime.now(timezone.utc)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt

    def _normalize_activity(
        self, user_id: uuid.UUID, raw: dict[str, Any], synced_at: datetime
    ) -> StravaActivity:
        sid = raw.get("id")
        strava_id = str(sid) if sid is not None else ""
        if not strava_id:
            raise ValueError("activity missing id")

        name = (raw.get("name") or "").strip() or "Activity"
        sport = (
            raw.get("sport_type")
            or raw.get("type")
            or "Workout"
        )
        if isinstance(sport, str):
            sport = sport.strip() or "Workout"
        else:
            sport = str(sport)

        m = raw.get("map")
        poly = None
        if isinstance(m, dict):
            poly = m.get("summary_polyline") or m.get("polyline")

        def fnum(key: str, default: float = 0.0) -> float:
            v = raw.get(key)
            if v is None:
                return default
            try:
                return float(v)
            except (TypeError, ValueError):
                return default

        def inum(key: str) -> int | None:
            v = raw.get(key)
            if v is None:
                return None
            try:
                return int(v)
            except (TypeError, ValueError):
                return None

        def fnum_opt(key: str) -> float | None:
            v = raw.get(key)
            if v is None:
                return None
            try:
                return float(v)
            except (TypeError, ValueError):
                return None

        return StravaActivity(
            user_id=user_id,
            strava_id=strava_id,
            name=name,
            sport_type=sport,
            start_date=self._parse_start_date(raw.get("start_date")),
            elapsed_time=int(raw.get("elapsed_time") or 0),
            distance=fnum("distance", 0.0),
            moving_time=int(raw.get("moving_time") or raw.get("elapsed_time") or 0),
            total_elevation_gain=fnum("total_elevation_gain", 0.0),
            avg_heartrate=fnum_opt("average_heartrate") or fnum_opt("avg_heartrate"),
            max_heartrate=fnum_opt("max_heartrate"),
            avg_watts=fnum_opt("average_watts"),
            weighted_avg_watts=fnum_opt("weighted_average_watts"),
            suffer_score=inum("suffer_score"),
            avg_cadence=fnum_opt("average_cadence"),
            avg_speed=fnum_opt("average_speed"),
            pr_count=inum("pr_count"),
            achievement_count=inum("achievement_count"),
            kudos_count=inum("kudos_count"),
            map_polyline=poly if isinstance(poly, str) else None,
            raw_data=dict(raw),
            synced_at=synced_at,
        )

    def sync_activities(self, user_id: str, db: Session, days_back: int = 60) -> dict[str, Any]:
        uid = uuid.UUID(user_id)
        row = db.query(UserSettings).filter(UserSettings.user_id == uid).first()
        if not row:
            raise RuntimeError("User settings not found")
        if not row.strava_connected:
            raise RuntimeError("Strava is not connected")

        access = self.refresh_token_if_needed(row)
        now_ts = int(time.time())
        after_ts = now_ts - int(days_back) * 86400

        synced = 0
        updated = 0
        errors: list[str] = []
        synced_at = datetime.now(timezone.utc)

        page = 1
        while True:
            try:
                batch = self.get_athlete_activities(
                    access, after_timestamp=after_ts, limit=100, page=page
                )
            except RuntimeError as e:
                errors.append(str(e))
                break

            if not batch:
                break

            for act in batch:
                if not isinstance(act, dict):
                    errors.append("unexpected activity payload type")
                    continue
                try:
                    norm = self._normalize_activity(uid, act, synced_at)
                    existing = (
                        db.query(StravaActivity)
                        .filter(
                            StravaActivity.user_id == uid,
                            StravaActivity.strava_id == norm.strava_id,
                        )
                        .first()
                    )
                    if existing:
                        for col in (
                            "name",
                            "sport_type",
                            "start_date",
                            "elapsed_time",
                            "distance",
                            "moving_time",
                            "total_elevation_gain",
                            "avg_heartrate",
                            "max_heartrate",
                            "avg_watts",
                            "weighted_avg_watts",
                            "suffer_score",
                            "avg_cadence",
                            "avg_speed",
                            "pr_count",
                            "achievement_count",
                            "kudos_count",
                            "map_polyline",
                            "raw_data",
                            "synced_at",
                        ):
                            setattr(existing, col, getattr(norm, col))
                        db.add(existing)
                        updated += 1
                    else:
                        db.add(norm)
                        synced += 1
                except Exception as e:  # noqa: BLE001 — collect per-activity errors
                    errors.append(f"activity {act.get('id')}: {e!s}")

            try:
                db.commit()
            except Exception as e:  # noqa: BLE001
                db.rollback()
                errors.append(f"commit page {page}: {e!s}")
                break

            if len(batch) < 100:
                break
            page += 1

        return {"synced": synced, "updated": updated, "errors": errors}

    def disconnect(self, user_id: str, db: Session) -> None:
        uid = uuid.UUID(user_id)
        row = db.query(UserSettings).filter(UserSettings.user_id == uid).first()
        if row:
            row.strava_access_token_encrypted = None
            row.strava_refresh_token_encrypted = None
            row.strava_token_expires_at = None
            row.strava_athlete_id = None
            row.strava_athlete_name = None
            row.strava_connected = False
            db.add(row)
        db.query(StravaActivity).filter(StravaActivity.user_id == uid).delete()
        db.commit()


def strava_oauth_configured() -> bool:
    return StravaService.oauth_configured()
