"""
Garmin Connect integration service using garminconnect / Garth OAuth tokens.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
)
from sqlalchemy.orm import Session

from models.models import UserSettings

_BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(_BACKEND_DIR / ".env")

logger = logging.getLogger(__name__)

# Default directory for Garth OAuth token files (oauth1_token.json, oauth2_token.json).
DEFAULT_TOKENSTORE = Path.home() / ".garminconnect"


def user_tokenstore(user_id: uuid.UUID) -> Path:
    """Per-user OAuth token directory under the server home directory."""
    return Path.home() / f".garminconnect_{user_id}"


def oauth_tokens_present(tokenstore: Path) -> bool:
    p = tokenstore.expanduser().resolve()
    return (
        p.is_dir()
        and (p / "oauth1_token.json").is_file()
        and (p / "oauth2_token.json").is_file()
    )


def read_token_bundle(tokenstore: Path) -> dict[str, Any]:
    """Load oauth1 + oauth2 JSON from a Garth token directory."""
    p = tokenstore.expanduser().resolve()
    o1 = json.loads((p / "oauth1_token.json").read_text(encoding="utf-8"))
    o2 = json.loads((p / "oauth2_token.json").read_text(encoding="utf-8"))
    return {"oauth1": o1, "oauth2": o2}


def write_token_bundle(tokenstore: Path, data: dict[str, Any]) -> None:
    """Write oauth1 + oauth2 JSON files for Garth."""
    p = tokenstore.expanduser().resolve()
    p.mkdir(parents=True, exist_ok=True)
    (p / "oauth1_token.json").write_text(
        json.dumps(data["oauth1"], ensure_ascii=False), encoding="utf-8"
    )
    (p / "oauth2_token.json").write_text(
        json.dumps(data["oauth2"], ensure_ascii=False), encoding="utf-8"
    )


def persist_garmin_tokens_encrypted(db: Session, user_id: uuid.UUID, tokenstore: Path) -> None:
    """Encrypt OAuth token JSON and store on UserSettings after a successful Garmin login."""
    if not oauth_tokens_present(tokenstore):
        return
    from user_settings_service import get_or_create_user_settings
    from utils.encryption import encrypt

    bundle = read_token_bundle(tokenstore)
    raw = json.dumps(bundle, separators=(",", ":"))
    row = get_or_create_user_settings(db, user_id)
    row.garmin_token_encrypted = encrypt(raw)
    db.add(row)
    db.commit()


def hydrate_garmin_tokenstore_from_db(db: Session, user_id: uuid.UUID, tokenstore: Path) -> bool:
    """If disk has no OAuth files but DB holds encrypted tokens, decrypt and write files."""
    if oauth_tokens_present(tokenstore):
        return True
    row = db.query(UserSettings).filter(UserSettings.user_id == user_id).first()
    if not row or not row.garmin_token_encrypted:
        return False
    from utils.encryption import decrypt

    plain = decrypt(row.garmin_token_encrypted)
    if not plain:
        return False
    try:
        data = json.loads(plain)
    except json.JSONDecodeError:
        return False
    if not isinstance(data, dict) or "oauth1" not in data or "oauth2" not in data:
        return False
    write_token_bundle(tokenstore, data)
    return True


def clear_garmin_token_files(tokenstore: Path) -> None:
    """Remove OAuth JSON files from disk (best-effort)."""
    p = tokenstore.expanduser().resolve()
    for name in ("oauth1_token.json", "oauth2_token.json"):
        fp = p / name
        if fp.is_file():
            try:
                fp.unlink()
            except OSError:
                logger.warning("Could not remove %s", fp)


def _parse_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            # Garmin often returns ISO strings without Z
            if value.endswith("Z"):
                value = value[:-1] + "+00:00"
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            return None
    return None


def _num(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _int(v: Any) -> int | None:
    if v is None:
        return None
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return None


def _activity_list_payload(raw: Any) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, dict)]
    if isinstance(raw, dict):
        for key in ("activityList", "activities", "activityDTOs"):
            inner = raw.get(key)
            if isinstance(inner, list):
                return [x for x in inner if isinstance(x, dict)]
    return []


def _merge_activity(summary: dict[str, Any], detail: dict[str, Any]) -> dict[str, Any]:
    merged: dict[str, Any] = {**summary}
    for k, v in detail.items():
        if v is not None:
            merged[k] = v
    return merged


def _normalize_activity_row(
    summary: dict[str, Any],
    detail: dict[str, Any],
    *,
    synced_at: datetime,
) -> dict[str, Any]:
    m = _merge_activity(summary, detail)
    aid = m.get("activityId") or m.get("activityID")
    activity_id = str(aid) if aid is not None else ""

    at = m.get("activityType")
    activity_type: str | None = None
    if isinstance(at, dict):
        activity_type = at.get("typeKey") or at.get("typeName")
    elif isinstance(at, str):
        activity_type = at

    start_time = _parse_datetime(
        m.get("startTimeLocal") or m.get("startTimeGMT") or m.get("startTime")
    )

    duration = m.get("duration")
    duration_seconds = _int(duration)
    if duration_seconds is None and isinstance(duration, (int, float)):
        duration_seconds = int(duration)

    distance_meters = _num(m.get("distance")) or _num(m.get("distanceMeters"))

    avg_hr = _int(m.get("averageHR") or m.get("avgHr") or m.get("averageHeartRate"))
    max_hr = _int(m.get("maxHR") or m.get("maxHr") or m.get("maxHeartRate"))
    calories = _int(m.get("calories") or m.get("activeKilocalories"))

    # Pace: prefer sec/km if present; else derive from distance/duration when sensible
    avg_pace: float | None = _num(m.get("averagePace")) or _num(m.get("avgPace"))
    if avg_pace is None and distance_meters and duration_seconds and duration_seconds > 0:
        # minutes per km as float
        km = distance_meters / 1000.0
        avg_pace = (duration_seconds / 60.0) / km if km > 0 else None

    training_load = _num(
        m.get("activityTrainingLoad")
        or m.get("trainingEffect")
        or m.get("trainingLoad")
    )

    te = m.get("aerobicTrainingEffect")
    if te is None and isinstance(m.get("trainingEffect"), dict):
        te = m["trainingEffect"].get("aerobic")
    aerobic_effect = _num(te)

    te2 = m.get("anaerobicTrainingEffect")
    if te2 is None and isinstance(m.get("trainingEffect"), dict):
        te2 = m["trainingEffect"].get("anaerobic")
    anaerobic_effect = _num(te2)

    return {
        "activity_id": activity_id,
        "activity_name": m.get("activityName"),
        "activity_type": activity_type,
        "start_time": start_time,
        "duration_seconds": duration_seconds,
        "distance_meters": distance_meters,
        "avg_heart_rate": avg_hr,
        "max_heart_rate": max_hr,
        "calories": calories,
        "avg_pace": avg_pace,
        "training_load": training_load,
        "aerobic_effect": aerobic_effect,
        "anaerobic_effect": anaerobic_effect,
        "raw_data": m,
        "synced_at": synced_at,
    }


def _extract_body_battery_range(bb_rows: Any, day: str) -> tuple[int | None, int | None]:
    """Pick min/max body battery for a calendar day from Garth daily body battery list."""
    if isinstance(bb_rows, dict):
        bb_rows = (
            bb_rows.get("bodyBatteryReports")
            or bb_rows.get("bodyBatteryValuesArray")
            or bb_rows.get("data")
            or []
        )
    if not isinstance(bb_rows, list):
        return None, None
    values: list[int] = []
    for row in bb_rows:
        if not isinstance(row, dict):
            continue
        row_date = row.get("date") or row.get("calendarDate")
        if row_date and str(row_date)[:10] != day:
            continue
        for key in (
            "charged",
            "bodyBattery",
            "bodyBatteryValue",
            "batteryLevel",
            "value",
        ):
            v = row.get(key)
            iv = _int(v)
            if iv is not None:
                values.append(iv)
                break
    if not values:
        return None, None
    return min(values), max(values)


def _normalize_daily_row(
    day: date,
    stats: dict[str, Any],
    heart: dict[str, Any],
    sleep: dict[str, Any],
    stress: dict[str, Any],
    body_battery: Any,
) -> dict[str, Any]:
    ds = day.isoformat()

    # User summary / stats (daily summary chart endpoint)
    resting_hr = _int(
        stats.get("restingHeartRate")
        or stats.get("restingHeartRateInBeatsPerMinute")
        or stats.get("rhr")
    )
    steps = _int(stats.get("totalSteps") or stats.get("steps"))

    vo2 = _num(stats.get("vo2Max") or stats.get("vo2MaxValue") or stats.get("vo2MaxRunning"))

    # Heart rates payload may nest wellness data
    if resting_hr is None and isinstance(heart.get("allDayHeartRateSamples"), list):
        # optional: could compute average; leave RHR from stats only
        pass
    if resting_hr is None:
        resting_hr = _int(heart.get("restingHeartRate"))

    # Stress: dailyStress often has avgStressLevel or stressPercentage
    avg_stress = _int(
        stress.get("avgStressLevel")
        or stress.get("averageStressLevel")
        or stress.get("stressLevel")
    )

    # Sleep
    sleep_seconds = _int(
        sleep.get("sleepTimeSeconds")
        or sleep.get("totalSleepTimeInSeconds")
        or sleep.get("durationInSeconds")
    )
    if sleep_seconds is None and isinstance(sleep.get("dailySleepDTO"), dict):
        dto = sleep["dailySleepDTO"]
        sleep_seconds = _int(dto.get("sleepTimeSeconds") or dto.get("totalSleepTimeInSeconds"))

    sleep_score = None
    ss = sleep.get("sleepScores")
    if isinstance(ss, dict):
        sleep_score = _int(ss.get("overall"))
    if sleep_score is None:
        sleep_score = _int(sleep.get("sleepScore"))

    bb_min, bb_max = _extract_body_battery_range(body_battery, ds)

    hrv_status: str | None = None
    if isinstance(stats.get("hrvStatus"), str):
        hrv_status = stats["hrvStatus"]
    elif isinstance(stats.get("hrv"), dict):
        hrv_status = stats["hrv"].get("status") or stats["hrv"].get("classification")

    raw_data = {
        "stats": stats,
        "heart_rates": heart,
        "sleep": sleep,
        "stress": stress,
        "body_battery": body_battery,
    }

    return {
        "date": day,
        "resting_heart_rate": resting_hr,
        "avg_stress": avg_stress,
        "sleep_duration_seconds": sleep_seconds,
        "sleep_score": sleep_score,
        "steps": steps,
        "body_battery_min": bb_min,
        "body_battery_max": bb_max,
        "vo2max": vo2,
        "hrv_status": hrv_status,
        "raw_data": raw_data,
    }


class GarminService:
    """High-level Garmin Connect operations with token persistence."""

    def __init__(
        self,
        *,
        tokenstore: Path | None = None,
        email: str | None = None,
        password: str | None = None,
    ) -> None:
        self._email = email or os.getenv("GARMIN_EMAIL", "").strip()
        self._password = password or os.getenv("GARMIN_PASSWORD", "")
        self._tokenstore = Path(tokenstore) if tokenstore else DEFAULT_TOKENSTORE

        self._client = Garmin(email=self._email or None, password=self._password or None)

        if self._has_oauth_files():
            try:
                self._client.garth.load(str(self._tokenstore.expanduser().resolve()))
                logger.debug("Preloaded OAuth tokens from %s", self._tokenstore)
            except (OSError, ValueError, KeyError, TypeError) as e:
                logger.info("Could not preload Garmin OAuth tokens: %s", e)

    def _has_oauth_files(self) -> bool:
        p = self._tokenstore.expanduser().resolve()
        return (
            p.is_dir()
            and (p / "oauth1_token.json").is_file()
            and (p / "oauth2_token.json").is_file()
        )

    def _tokenstore_arg(self) -> str | None:
        return str(self._tokenstore.expanduser().resolve()) if self._has_oauth_files() else None

    def _save_tokens(self) -> None:
        path = str(self._tokenstore.expanduser().resolve())
        self._client.garth.dump(path)
        logger.info("Saved Garmin OAuth tokens to %s", path)

    def login(self) -> dict[str, Any]:
        """
        Resume session from saved Garth tokens, or perform full email/password login.
        Persists tokens to ``tokenstore`` after success.
        """
        if not self._tokenstore_arg() and (not self._email or not self._password):
            raise GarminConnectAuthenticationError(
                "No OAuth tokens found in ~/.garminconnect — set GARMIN_EMAIL and GARMIN_PASSWORD for initial login"
            )

        try:
            try:
                self._client.login(tokenstore=self._tokenstore_arg())
            except FileNotFoundError:
                # Missing or incomplete token files — force credential flow
                self._client.login(tokenstore=None)

            self._save_tokens()
            resolved_email = self._email or self._client.display_name or ""
            return {"status": "ok", "email": resolved_email}
        except GarminConnectAuthenticationError as e:
            raise GarminConnectAuthenticationError(
                f"Garmin authentication failed: {e}. Check credentials and token files under {self._tokenstore}."
            ) from e
        except GarminConnectConnectionError as e:
            raise GarminConnectConnectionError(
                f"Could not reach Garmin Connect during login: {e}"
            ) from e

    def get_recent_activities(self, limit: int = 20) -> list[dict[str, Any]]:
        """Fetch recent activities and full detail per activity, normalized for ``GarminActivity``."""
        try:
            raw = self._client.get_activities(0, limit)
            summaries = _activity_list_payload(raw)
            synced_at = datetime.now(timezone.utc)
            out: list[dict[str, Any]] = []
            for s in summaries:
                aid = s.get("activityId") or s.get("activityID")
                if aid is None:
                    continue
                detail: dict[str, Any] = {}
                try:
                    detail = self._client.get_activity(str(aid))
                except GarminConnectConnectionError as e:
                    logger.warning("Skipping detail for activity %s: %s", aid, e)
                except GarminConnectAuthenticationError:
                    raise
                out.append(_normalize_activity_row(s, detail, synced_at=synced_at))
            return out
        except GarminConnectAuthenticationError as e:
            raise GarminConnectAuthenticationError(
                f"Garmin authentication failed while fetching activities: {e}"
            ) from e
        except GarminConnectConnectionError as e:
            raise GarminConnectConnectionError(
                f"Garmin Connect error while fetching activities: {e}"
            ) from e

    def _fetch_daily_bundle(self, ds: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any], Any]:
        """Fetch the five daily endpoints; tolerate empty/missing data."""

        def safe_stats() -> dict[str, Any]:
            try:
                return self._client.get_stats(ds)
            except GarminConnectAuthenticationError:
                raise
            except GarminConnectConnectionError as e:
                if "No data received" in str(e):
                    return {}
                raise

        def safe_hr() -> dict[str, Any]:
            try:
                return self._client.get_heart_rates(ds)
            except GarminConnectAuthenticationError:
                raise
            except GarminConnectConnectionError as e:
                if "No heart rate data" in str(e) or "No data" in str(e):
                    return {}
                raise

        def safe_sleep() -> dict[str, Any]:
            try:
                return self._client.get_sleep_data(ds)
            except GarminConnectAuthenticationError:
                raise
            except GarminConnectConnectionError:
                return {}

        def safe_stress() -> dict[str, Any]:
            try:
                return self._client.get_stress_data(ds)
            except GarminConnectAuthenticationError:
                raise
            except GarminConnectConnectionError:
                return {}

        def safe_bb() -> Any:
            try:
                return self._client.get_body_battery(ds, ds)
            except GarminConnectAuthenticationError:
                raise
            except GarminConnectConnectionError:
                return []

        return (
            safe_stats(),
            safe_hr(),
            safe_sleep(),
            safe_stress(),
            safe_bb(),
        )

    def get_daily_metrics(self, days: int = 30) -> list[dict[str, Any]]:
        """Daily wellness rows normalized for ``DailyMetrics`` (last ``days`` calendar days)."""
        try:
            today = date.today()
            rows: list[dict[str, Any]] = []
            for i in range(days):
                day = today - timedelta(days=i)
                ds = day.isoformat()
                stats, heart, sleep, stress, bb = self._fetch_daily_bundle(ds)
                rows.append(_normalize_daily_row(day, stats, heart, sleep, stress, bb))
            return rows
        except GarminConnectAuthenticationError as e:
            raise GarminConnectAuthenticationError(
                f"Garmin authentication failed while fetching daily metrics: {e}"
            ) from e
        except GarminConnectConnectionError as e:
            raise GarminConnectConnectionError(
                f"Garmin Connect error while fetching daily metrics: {e}"
            ) from e

    def get_user_profile(self) -> dict[str, Any]:
        """Display name plus today's user summary (steps, stress, etc.)."""
        try:
            today = date.today().isoformat()
            return {
                "full_name": self._client.get_full_name(),
                "user_summary": self._client.get_user_summary(today),
            }
        except GarminConnectAuthenticationError as e:
            raise GarminConnectAuthenticationError(
                f"Garmin authentication failed while fetching profile: {e}"
            ) from e
        except GarminConnectConnectionError as e:
            raise GarminConnectConnectionError(
                f"Garmin Connect error while fetching profile: {e}"
            ) from e
