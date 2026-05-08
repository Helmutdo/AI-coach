"""Orchestrates Garmin API fetch + DB upsert with partial-error reporting."""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timezone
from typing import Any

from garminconnect import (
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
)
from sqlalchemy.orm import Session

from models.models import DailyMetrics, GarminActivity
from services.garmin_service import (
    DEFAULT_TOKENSTORE,
    GarminService,
    hydrate_garmin_tokenstore_from_db,
    oauth_tokens_present,
    user_tokenstore,
)

logger = logging.getLogger(__name__)


def tokens_on_disk() -> bool:
    """Legacy helper: default global token dir (startup / old scripts)."""
    return oauth_tokens_present(DEFAULT_TOKENSTORE)


def _dict_to_activity(row: dict[str, Any], user_id: uuid.UUID) -> GarminActivity:
    st = row.get("start_time")
    if isinstance(st, str):
        try:
            st = datetime.fromisoformat(st.replace("Z", "+00:00"))
        except ValueError:
            st = None
    synced = row.get("synced_at")
    if isinstance(synced, str):
        try:
            synced = datetime.fromisoformat(synced.replace("Z", "+00:00"))
        except ValueError:
            synced = datetime.now(timezone.utc)
    elif synced is None:
        synced = datetime.now(timezone.utc)
    return GarminActivity(
        user_id=user_id,
        activity_id=str(row["activity_id"]),
        activity_name=row.get("activity_name"),
        activity_type=row.get("activity_type"),
        start_time=st,
        duration_seconds=row.get("duration_seconds"),
        distance_meters=row.get("distance_meters"),
        avg_heart_rate=row.get("avg_heart_rate"),
        max_heart_rate=row.get("max_heart_rate"),
        calories=row.get("calories"),
        avg_pace=row.get("avg_pace"),
        training_load=row.get("training_load"),
        aerobic_effect=row.get("aerobic_effect"),
        anaerobic_effect=row.get("anaerobic_effect"),
        raw_data=row.get("raw_data"),
        synced_at=synced,
    )


def _dict_to_daily(row: dict[str, Any], user_id: uuid.UUID) -> DailyMetrics:
    d = row.get("date")
    if isinstance(d, str):
        d = date.fromisoformat(d[:10])
    if d is None:
        raise ValueError("daily row missing date")
    return DailyMetrics(
        user_id=user_id,
        date=d,
        resting_heart_rate=row.get("resting_heart_rate"),
        avg_stress=row.get("avg_stress"),
        sleep_duration_seconds=row.get("sleep_duration_seconds"),
        sleep_score=row.get("sleep_score"),
        steps=row.get("steps"),
        body_battery_min=row.get("body_battery_min"),
        body_battery_max=row.get("body_battery_max"),
        vo2max=row.get("vo2max"),
        hrv_status=row.get("hrv_status"),
        raw_data=row.get("raw_data"),
    )


def _upsert_activity(db: Session, row: dict[str, Any], user_id: uuid.UUID) -> None:
    aid = str(row["activity_id"])
    existing = (
        db.query(GarminActivity)
        .filter(
            GarminActivity.user_id == user_id,
            GarminActivity.activity_id == aid,
        )
        .first()
    )
    new_obj = _dict_to_activity(row, user_id)
    if existing:
        for col in (
            "activity_name",
            "activity_type",
            "start_time",
            "duration_seconds",
            "distance_meters",
            "avg_heart_rate",
            "max_heart_rate",
            "calories",
            "avg_pace",
            "training_load",
            "aerobic_effect",
            "anaerobic_effect",
            "raw_data",
            "synced_at",
        ):
            setattr(existing, col, getattr(new_obj, col))
    else:
        db.add(new_obj)


def _upsert_daily(db: Session, row: dict[str, Any], user_id: uuid.UUID) -> None:
    new_obj = _dict_to_daily(row, user_id)
    existing = (
        db.query(DailyMetrics)
        .filter(
            DailyMetrics.user_id == user_id,
            DailyMetrics.date == new_obj.date,
        )
        .first()
    )
    if existing:
        for col in (
            "resting_heart_rate",
            "avg_stress",
            "sleep_duration_seconds",
            "sleep_score",
            "steps",
            "body_battery_min",
            "body_battery_max",
            "vo2max",
            "hrv_status",
            "raw_data",
        ):
            setattr(existing, col, getattr(new_obj, col))
    else:
        db.add(new_obj)


class SyncService:
    """Fetch from Garmin Connect and upsert into the database."""

    @staticmethod
    def garmin_session_ready(
        *,
        db: Session,
        user_id: uuid.UUID,
        app_state_active: bool,
    ) -> bool:
        ts = user_tokenstore(user_id)
        hydrate_garmin_tokenstore_from_db(db, user_id, ts)
        return bool(app_state_active or oauth_tokens_present(ts))

    @staticmethod
    def full_sync(
        db: Session,
        *,
        user_id: uuid.UUID,
        app_state_active: bool = False,
    ) -> dict[str, Any]:
        """
        Login check → fetch activities + daily metrics → upsert → commit.

        Returns partial counts and a list of error strings when the Garmin API
        fails for a phase or individual rows.
        """
        errors: list[str] = []
        activities: list[dict[str, Any]] = []
        daily: list[dict[str, Any]] = []

        tokenstore = user_tokenstore(user_id)
        if not SyncService.garmin_session_ready(
            db=db, user_id=user_id, app_state_active=app_state_active
        ):
            msg = "Garmin session not active — connect in Settings or ensure OAuth tokens exist"
            errors.append(msg)
            return {
                "synced_activities": 0,
                "synced_days": 0,
                "errors": errors,
                "partial": True,
            }

        svc = GarminService(tokenstore=tokenstore)
        try:
            activities = svc.get_recent_activities(20)
        except GarminConnectAuthenticationError as e:
            errors.append(f"Activities fetch (auth): {e}")
        except GarminConnectConnectionError as e:
            errors.append(f"Activities fetch (connection): {e}")
        except Exception as e:
            errors.append(f"Activities fetch: {e}")
            logger.exception("Unexpected error fetching activities")

        try:
            daily = svc.get_daily_metrics(30)
        except GarminConnectAuthenticationError as e:
            errors.append(f"Daily metrics fetch (auth): {e}")
        except GarminConnectConnectionError as e:
            errors.append(f"Daily metrics fetch (connection): {e}")
        except Exception as e:
            errors.append(f"Daily metrics fetch: {e}")
            logger.exception("Unexpected error fetching daily metrics")

        act_count = 0
        for row in activities:
            if not row.get("activity_id"):
                continue
            try:
                _upsert_activity(db, row, user_id)
                act_count += 1
            except Exception as e:
                errors.append(f"Upsert activity {row.get('activity_id')}: {e}")

        day_count = 0
        for row in daily:
            try:
                _upsert_daily(db, row, user_id)
                day_count += 1
            except ValueError as e:
                errors.append(f"Daily row skipped: {e}")
            except Exception as e:
                errors.append(f"Upsert daily: {e}")

        try:
            db.commit()
        except Exception as e:
            db.rollback()
            errors.append(f"Database commit failed: {e}")
            return {
                "synced_activities": 0,
                "synced_days": 0,
                "errors": errors,
                "partial": True,
            }

        partial = bool(errors)
        return {
            "synced_activities": act_count,
            "synced_days": day_count,
            "errors": errors,
            "partial": partial,
        }
