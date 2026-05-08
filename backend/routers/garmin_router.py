"""Sync and read Garmin-derived data from the database."""

from __future__ import annotations

import hashlib
import io
import uuid
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import and_, desc, func
from sqlalchemy.orm import Session

from database.database import get_db
from dependencies.auth import get_current_user_id
from models.models import DailyMetrics, GarminActivity, StravaActivity
from services.sync_service import SyncService

router = APIRouter(prefix="/garmin", tags=["garmin"])
limiter = Limiter(key_func=get_remote_address)

# Spanish column names from Garmin Connect CSV export
_CSV_COL = {
    "tipo": "Tipo de actividad",
    "fecha": "Fecha",
    "titulo": "Título",
    "distancia": "Distancia",
    "calorias": "Calorías",
    "tiempo": "Tiempo",
    "fc_media": "Frecuencia cardiaca media",
    "fc_max": "FC máxima",
    "te_aerobico": "TE aeróbico",
    "te_anaerobico": "TE anaeróbico",
    "training_stress": "Training Stress Score®",
    "potencia_media": "Potencia media",
    "potencia_max": "Potencia máxima",
}

# Spanish activity type → canonical name
_TYPE_MAP: dict[str, str] = {
    "carrera": "Running",
    "ciclismo": "Cycling",
    "natación": "Swimming",
    "entreno de fuerza": "Strength Training",
    "triatlon": "Triathlon",
    "triatlón": "Triathlon",
    "caminata": "Walking",
    "senderismo": "Hiking",
    "ciclismo indoor": "Indoor Cycling",
    "yoga": "Yoga",
    "multideporte": "Multi-Sport",
    "cardio": "Cardio",
    "elíptica": "Elliptical",
    "remo": "Rowing",
    "esquí de fondo": "Cross-Country Skiing",
    "snowboard": "Snowboard",
    "paddleboarding": "Paddleboarding",
    "escalada interior": "Indoor Climbing",
}


def _map_type(raw: str) -> str:
    return _TYPE_MAP.get(raw.strip().lower(), raw.strip())


def _parse_duration(s: str) -> int | None:
    """HH:MM:SS or MM:SS → seconds. Returns None if invalid."""
    s = s.strip()
    if not s or s == "--":
        return None
    # Remove sub-second suffix like "00:40:21.0"
    s = s.split(".")[0]
    parts = s.split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
    except ValueError:
        pass
    return None


def _parse_float(s: str) -> float | None:
    s = s.strip().replace(",", ".")
    if not s or s == "--":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_int(s: str) -> int | None:
    s = s.strip().replace(",", "")
    if not s or s == "--":
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def _csv_activity_id(user_id: uuid.UUID, start_time: datetime, title: str) -> str:
    raw = f"{user_id}|{start_time.isoformat()}|{title}"
    digest = hashlib.sha256(raw.encode()).hexdigest()[:16]
    return f"csv_{digest}"


def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


@router.post("/sync")
@limiter.limit("5/minute")
def sync_garmin(
    request: Request,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    uid = uuid.UUID(user_id)
    result = SyncService.full_sync(
        db,
        user_id=uid,
        app_state_active=getattr(request.app.state, "garmin_session_active", False),
    )
    if result.get("synced_activities", 0) or result.get("synced_days", 0):
        request.app.state.garmin_session_active = True
    return result


@router.get("/activities")
def list_activities(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
    limit: int = Query(100, ge=1, le=500),
    days: int = Query(30, ge=1, le=400),
) -> list[dict[str, Any]]:
    uid = uuid.UUID(user_id)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (
        db.query(GarminActivity)
        .filter(
            GarminActivity.user_id == uid,
            GarminActivity.start_time >= cutoff,
        )
        .order_by(desc(GarminActivity.start_time), desc(GarminActivity.id))
        .limit(limit)
        .all()
    )
    out: list[dict[str, Any]] = []
    for a in rows:
        raw = a.raw_data or {}
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
                "source": raw.get("source", "garmin"),
            }
        )
    return out


@router.post("/upload-csv")
@limiter.limit("10/minute")
def upload_garmin_csv(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    """Import a Garmin Connect CSV export.

    Cross-references existing Strava activities to avoid duplicates.
    Returns counts of inserted, skipped, and error rows.
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload a .csv file.")

    raw_bytes = file.file.read(5 * 1024 * 1024 + 1)  # 5 MB limit
    if len(raw_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="CSV file too large (max 5 MB).")
    try:
        text = raw_bytes.decode("utf-8")
    except UnicodeDecodeError:
        text = raw_bytes.decode("latin-1")

    import csv as _csv

    reader = _csv.DictReader(io.StringIO(text))
    uid = uuid.UUID(user_id)
    now = datetime.now(timezone.utc)

    inserted = 0
    skipped = 0
    errors: list[str] = []

    # Preload Strava start dates for dedup (within the CSV date range)
    strava_dates: list[datetime] = [
        r.start_date
        for r in db.query(StravaActivity.start_date)
        .filter(StravaActivity.user_id == uid)
        .all()
        if r.start_date
    ]

    def _near_strava(dt: datetime) -> bool:
        """True when a Strava activity exists within 15 minutes."""
        for sd in strava_dates:
            sd_naive = sd.replace(tzinfo=None) if sd.tzinfo else sd
            dt_naive = dt.replace(tzinfo=None) if dt.tzinfo else dt
            if abs((sd_naive - dt_naive).total_seconds()) < 900:
                return True
        return False

    for row_num, row in enumerate(reader, start=2):
        try:
            fecha_raw = row.get("Fecha", "").strip()
            if not fecha_raw or fecha_raw == "--":
                skipped += 1
                continue

            try:
                start_dt = datetime.strptime(fecha_raw, "%Y-%m-%d %H:%M:%S")
                start_dt = start_dt.replace(tzinfo=timezone.utc)
            except ValueError:
                errors.append(f"Row {row_num}: bad date format '{fecha_raw}'")
                skipped += 1
                continue

            tipo_raw = row.get("Tipo de actividad", "").strip()
            titulo = row.get("Título", "").strip() or tipo_raw
            activity_type = _map_type(tipo_raw)
            act_id = _csv_activity_id(uid, start_dt, titulo)

            # Skip if already in DB (same activity_id)
            exists = (
                db.query(GarminActivity.id)
                .filter(
                    GarminActivity.user_id == uid,
                    GarminActivity.activity_id == act_id,
                )
                .first()
            )
            if exists:
                skipped += 1
                continue

            # Skip if a Garmin API activity exists within ±5 min (non-CSV)
            cutoff_lo = start_dt - timedelta(minutes=5)
            cutoff_hi = start_dt + timedelta(minutes=5)
            dup = (
                db.query(GarminActivity.id)
                .filter(
                    GarminActivity.user_id == uid,
                    GarminActivity.start_time >= cutoff_lo,
                    GarminActivity.start_time <= cutoff_hi,
                    GarminActivity.activity_type == activity_type,
                    ~GarminActivity.activity_id.like("csv_%"),
                )
                .first()
            )
            if dup:
                skipped += 1
                continue

            dist_km = _parse_float(row.get("Distancia", ""))
            duration_s = _parse_duration(row.get("Tiempo", ""))
            calories = _parse_int(row.get("Calorías", ""))
            avg_hr = _parse_int(row.get("Frecuencia cardiaca media", ""))
            max_hr = _parse_int(row.get("FC máxima", ""))
            aerobic_e = _parse_float(row.get("TE aeróbico", ""))

            linked_strava = _near_strava(start_dt)

            act = GarminActivity(
                user_id=uid,
                activity_id=act_id,
                activity_name=titulo,
                activity_type=activity_type,
                start_time=start_dt,
                duration_seconds=duration_s,
                distance_meters=dist_km * 1000 if dist_km is not None else None,
                avg_heart_rate=avg_hr,
                max_heart_rate=max_hr,
                calories=calories,
                aerobic_effect=aerobic_e,
                synced_at=now,
                raw_data={
                    "source": "csv",
                    "linked_strava": linked_strava,
                },
            )
            db.add(act)
            inserted += 1

        except Exception as exc:
            errors.append(f"Row {row_num}: {exc}")
            skipped += 1
            continue

    db.commit()
    return {
        "inserted": inserted,
        "skipped": skipped,
        "errors": errors[:20],
        "total_rows": inserted + skipped,
    }


@router.get("/daily-metrics")
def list_daily_metrics(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
    days: int = Query(30, ge=1, le=366),
) -> list[dict[str, Any]]:
    uid = uuid.UUID(user_id)
    start = date.today() - timedelta(days=days - 1)
    rows = (
        db.query(DailyMetrics)
        .filter(DailyMetrics.user_id == uid, DailyMetrics.date >= start)
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
def garmin_summary(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    uid = uuid.UUID(user_id)
    today = date.today()
    ws = _week_start(today)
    we = ws + timedelta(days=6)

    start_dt = datetime.combine(ws, time(0, 0, 0))
    end_dt = datetime.combine(we, time(23, 59, 59))
    act_count = (
        db.query(func.count(GarminActivity.id))
        .filter(
            GarminActivity.user_id == uid,
            GarminActivity.start_time.isnot(None),
            GarminActivity.start_time >= start_dt,
            GarminActivity.start_time <= end_dt,
        )
        .scalar()
    ) or 0

    week_metrics = (
        db.query(DailyMetrics)
        .filter(
            DailyMetrics.user_id == uid,
            DailyMetrics.date >= ws,
            DailyMetrics.date <= today,
        )
        .all()
    )

    sleep_scores = [m.sleep_score for m in week_metrics if m.sleep_score is not None]
    avg_sleep = sum(sleep_scores) / len(sleep_scores) if sleep_scores else None

    hrv_list = [m.hrv_status for m in week_metrics if m.hrv_status]
    hrv_mode = Counter(hrv_list).most_common(1)[0][0] if hrv_list else None

    latest = (
        db.query(DailyMetrics)
        .filter(DailyMetrics.user_id == uid)
        .order_by(desc(DailyMetrics.date))
        .first()
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
