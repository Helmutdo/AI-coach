"""SQLAlchemy ORM models for AI Coach."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from database.database import Base


class User(Base):
    """Registered user (Google OAuth identity)."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    google_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(512), nullable=False)
    name: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    avatar_url: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class UserSettings(Base):
    """Per-user settings (Garmin account + AI provider credentials)."""

    __tablename__ = "user_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    garmin_email: Mapped[str] = mapped_column(String(255), nullable=False)
    ai_provider: Mapped[str] = mapped_column(String(32), nullable=False, default="anthropic")
    ai_api_key_encrypted: Mapped[str] = mapped_column(Text, nullable=False, default="")
    garmin_token_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    strava_access_token_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    strava_refresh_token_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    strava_token_expires_at: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    strava_athlete_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    strava_athlete_name: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    strava_connected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class GarminActivity(Base):
    """Synced activity from Garmin CSV export or OAuth."""

    __tablename__ = "garmin_activities"

    __table_args__ = (
        UniqueConstraint("user_id", "activity_id", name="uq_garmin_activity_user_activity"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    activity_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    activity_name: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    activity_type: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    start_time: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    distance_meters: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    avg_heart_rate: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    max_heart_rate: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    calories: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    avg_pace: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    training_load: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    aerobic_effect: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    anaerobic_effect: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    raw_data: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class StravaActivity(Base):
    """Synced activity from Strava API."""

    __tablename__ = "strava_activities"

    __table_args__ = (
        UniqueConstraint("user_id", "strava_id", name="uq_strava_activity_user_strava_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    strava_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(1024), nullable=False)
    sport_type: Mapped[str] = mapped_column(String(128), nullable=False)
    start_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    elapsed_time: Mapped[int] = mapped_column(Integer, nullable=False)
    distance: Mapped[float] = mapped_column(Float, nullable=False)
    moving_time: Mapped[int] = mapped_column(Integer, nullable=False)
    total_elevation_gain: Mapped[float] = mapped_column(Float, nullable=False)
    avg_heartrate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    max_heartrate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    avg_watts: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    weighted_avg_watts: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    suffer_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    avg_cadence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    avg_speed: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pr_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    achievement_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    kudos_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    map_polyline: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    raw_data: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class DailyMetrics(Base):
    """Aggregated daily wellness / training metrics."""

    __tablename__ = "daily_metrics"

    __table_args__ = (UniqueConstraint("user_id", "date", name="uq_daily_metrics_user_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    resting_heart_rate: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    avg_stress: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sleep_duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sleep_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    steps: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    body_battery_min: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    body_battery_max: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    vo2max: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    hrv_status: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    hrv_rmssd_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    hrv_7d_avg_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    hrv_ref_low_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    hrv_ref_high_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    raw_data: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)


class ChatMessage(Base):
    """Coach chat history."""

    __tablename__ = "chat_messages"

    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant')", name="ck_chatmessage_role"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    conversation_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True, default="default")
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    context_snapshot: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)


class AthleteProfile(Base):
    """Athlete physical profile and training goals for personalized AI coaching."""

    __tablename__ = "athlete_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    sex: Mapped[str] = mapped_column(String(16), nullable=False)
    birth_year: Mapped[int] = mapped_column(Integer, nullable=False)
    weight_kg: Mapped[float] = mapped_column(Float, nullable=False)
    height_cm: Mapped[float] = mapped_column(Float, nullable=False)
    injuries: Mapped[str] = mapped_column(Text, nullable=False)
    hours_per_week: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    experience: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    years_in_triathlon: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    target_distance: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    primary_goal: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    next_race_date: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    vo2max: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
