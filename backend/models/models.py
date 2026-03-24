"""SQLAlchemy ORM models for Garmin AI Coach."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from database.database import Base


class UserSettings(Base):
    """Per-installation settings (Garmin account + AI provider credentials)."""

    __tablename__ = "user_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    garmin_email: Mapped[str] = mapped_column(String(255), nullable=False)
    ai_provider: Mapped[str] = mapped_column(String(32), nullable=False, default="anthropic")
    # Ciphertext or token produced by app-layer encryption; not encrypted by SQLAlchemy.
    ai_api_key: Mapped[str] = mapped_column(Text, nullable=False)
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
    """Synced activity summary from Garmin Connect."""

    __tablename__ = "garmin_activities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    activity_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
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


class DailyMetrics(Base):
    """Aggregated daily wellness / training metrics."""

    __tablename__ = "daily_metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[date] = mapped_column(Date, unique=True, nullable=False, index=True)
    resting_heart_rate: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    avg_stress: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sleep_duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sleep_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    steps: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    body_battery_min: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    body_battery_max: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    vo2max: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    hrv_status: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    raw_data: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)


class ChatMessage(Base):
    """Coach chat history."""

    __tablename__ = "chat_messages"

    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant')", name="ck_chatmessage_role"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True, default="default")
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    context_snapshot: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
