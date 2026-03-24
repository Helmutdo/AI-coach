"""Sync and read Garmin-derived data from the database."""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, time, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import and_, desc, func
from sqlalchemy.orm import Session

from database.database import get_db
from models.models import DailyMetrics, GarminActivity
from services.sync_service import SyncService

router = APIRouter(prefix="/garmin", tags=["garmin"])


def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


@router.post("/sync")
def sync_garmin(request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    result = SyncService.full_sync(
        db,
        app_state_active=getattr(request.app.state, "garmin_session_active", False),
    )
    if result.get("synced_activities", 0) or result.get("synced_days", 0):
        request.app.state.garmin_session_active = True
    return result


@router.get("/activities")
def list_activities(
    db: Session = Depends(get_db),
    limit: int = Query(20, ge=1, le=200),
) -> list[dict[str, Any]]:
    rows = (
        db.query(GarminActivity)
        .order_by(desc(GarminActivity.start_time), desc(GarminActivity.id))
        .limit(limit)
        .all()
    )
    out: list[dict[str, Any]] = []
    for a in rows:
        out.append(
            {
                "id": a.id,
                "activity_id": a.activity_id,
                "activity_name": a.activity_name,
                "activity_type": a.activity_type,
                "start_time": a.start_time.isoformat() if a.start_time else None,
                "duration_seconds": a.duration_seconds,
                "distance_meters": a.distance_meters,
                "avg_heart_rate": a.avg_heart_rate,
                "max_heart_rate": a.max_heart_rate,
                "calories": a.calories,
                "avg_pace": a.avg_pace,
                "training_load": a.training_load,
                "aerobic_effect": a.aerobic_effect,
                "anaerobic_effect": a.anaerobic_effect,
                "synced_at": a.synced_at.isoformat() if a.synced_at else None,
            }
        )
    return out


@router.get("/daily-metrics")
def list_daily_metrics(
    db: Session = Depends(get_db),
    days: int = Query(30, ge=1, le=366),
) -> list[dict[str, Any]]:
    start = date.today() - timedelta(days=days - 1)
    rows = (
        db.query(DailyMetrics)
        .filter(DailyMetrics.date >= start)
        .order_by(desc(DailyMetrics.date))
        .all()
    )
    return [
        {
            "id": m.id,
            "date": m.date.isoformat(),
            "resting_heart_rate": m.resting_heart_rate,
            "avg_stress": m.avg_stress,
            "sleep_duration_seconds": m.sleep_duration_seconds,
            "sleep_score": m.sleep_score,
            "steps": m.steps,
            "body_battery_min": m.body_battery_min,
            "body_battery_max": m.body_battery_max,
            "vo2max": m.vo2max,
            "hrv_status": m.hrv_status,
        }
        for m in rows
    ]


@router.get("/summary")
def garmin_summary(db: Session = Depends(get_db)) -> dict[str, Any]:
    today = date.today()
    ws = _week_start(today)
    we = ws + timedelta(days=6)

    start_dt = datetime.combine(ws, time(0, 0, 0))
    end_dt = datetime.combine(we, time(23, 59, 59))
    act_count = (
        db.query(func.count(GarminActivity.id))
        .filter(
            and_(
                GarminActivity.start_time.isnot(None),
                GarminActivity.start_time >= start_dt,
                GarminActivity.start_time <= end_dt,
            )
        )
        .scalar()
    ) or 0

    week_metrics = (
        db.query(DailyMetrics)
        .filter(DailyMetrics.date >= ws, DailyMetrics.date <= today)
        .all()
    )

    sleep_scores = [m.sleep_score for m in week_metrics if m.sleep_score is not None]
    avg_sleep = sum(sleep_scores) / len(sleep_scores) if sleep_scores else None

    hrv_list = [m.hrv_status for m in week_metrics if m.hrv_status]
    hrv_mode = Counter(hrv_list).most_common(1)[0][0] if hrv_list else None

    latest = (
        db.query(DailyMetrics).order_by(desc(DailyMetrics.date)).first()
    )
    body_battery = None
    if latest:
        body_battery = {
            "date": latest.date.isoformat(),
            "min": latest.body_battery_min,
            "max": latest.body_battery_max,
        }

    return {
        "week_start": ws.isoformat(),
        "activities_this_week": int(act_count),
        "avg_sleep_score": round(avg_sleep, 2) if avg_sleep is not None else None,
        "hrv_status_mode": hrv_mode,
        "current_body_battery": body_battery,
    }
