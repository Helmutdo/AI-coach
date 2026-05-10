"""ORM rows → dicts for AICoachService / context."""

from __future__ import annotations

from typing import Any

from models.models import DailyMetrics, GarminActivity, StravaActivity


def activity_to_dict(a: GarminActivity) -> dict[str, Any]:
    return {
        "activity_id": a.activity_id,
        "activity_name": a.activity_name,
        "activity_type": a.activity_type,
        "start_time": a.start_time,
        "duration_seconds": a.duration_seconds,
        "distance_meters": a.distance_meters,
        "avg_heart_rate": a.avg_heart_rate,
        "max_heart_rate": a.max_heart_rate,
        "calories": a.calories,
        "avg_pace": a.avg_pace,
        "training_load": a.training_load,
        "aerobic_effect": a.aerobic_effect,
        "anaerobic_effect": a.anaerobic_effect,
        "raw_data": a.raw_data,
        "synced_at": a.synced_at,
    }


def strava_activity_to_dict(a: StravaActivity) -> dict[str, Any]:
    return {
        "strava_id": a.strava_id,
        "name": a.name,
        "sport_type": a.sport_type,
        "start_time": a.start_date,
        "elapsed_time": a.elapsed_time,
        "moving_time": a.moving_time,
        "distance": a.distance,
        "avg_heartrate": a.avg_heartrate,
        "suffer_score": a.suffer_score,
        "raw_data": a.raw_data,
        "synced_at": a.synced_at,
    }


def daily_metrics_to_dict(m: DailyMetrics) -> dict[str, Any]:
    return {
        "date": m.date,
        "resting_heart_rate": m.resting_heart_rate,
        "avg_stress": m.avg_stress,
        "sleep_duration_seconds": m.sleep_duration_seconds,
        "sleep_score": m.sleep_score,
        "steps": m.steps,
        "body_battery_min": m.body_battery_min,
        "body_battery_max": m.body_battery_max,
        "vo2max": m.vo2max,
        "hrv_status": m.hrv_status,
        "hrv_rmssd_ms": m.hrv_rmssd_ms,
        "hrv_7d_avg_ms": m.hrv_7d_avg_ms,
        "hrv_ref_low_ms": m.hrv_ref_low_ms,
        "hrv_ref_high_ms": m.hrv_ref_high_ms,
        "raw_data": m.raw_data,
    }
