"""Athlete profile — GET and upsert endpoints."""

from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database.database import get_db
from dependencies.auth import get_current_user_id
from models.models import AthleteProfile
from schemas.profile_schema import AthleteProfileIn, AthleteProfileOut

router = APIRouter(prefix="/profile", tags=["profile"])


def format_profile_for_prompt(profile: AthleteProfile) -> str:
    """Return a compact text block for injection into the AI coach system prompt."""
    age = date.today().year - profile.birth_year
    parts = [
        f"Athlete profile: {profile.sex.capitalize()}, {age} years old, "
        f"{profile.weight_kg}kg, {profile.height_cm}cm.",
    ]
    if profile.experience:
        years = (
            f", {profile.years_in_triathlon} years in triathlon"
            if profile.years_in_triathlon
            else ""
        )
        parts.append(f"Experience: {profile.experience.capitalize()} triathlete{years}.")
    if profile.target_distance or profile.primary_goal:
        dist = profile.target_distance or "unknown"
        goal = profile.primary_goal.replace("_", " ") if profile.primary_goal else "unspecified"
        dist_label = dist if dist == "70.3" else dist.capitalize()
        parts.append(f"Target: {dist_label}. Goal: {goal}.")
    if profile.injuries and profile.injuries.lower() != "none":
        parts.append(f"Health notes: {profile.injuries}.")
    if profile.hours_per_week:
        parts.append(f"Training: ~{profile.hours_per_week}h/week.")
    if profile.next_race_date:
        parts.append(f"Next race: {profile.next_race_date}.")
    return " ".join(parts)


@router.get("", response_model=AthleteProfileOut)
def get_profile(
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> AthleteProfile:
    uid = uuid.UUID(user_id)
    row = db.query(AthleteProfile).filter(AthleteProfile.user_id == uid).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return row


@router.post("", response_model=AthleteProfileOut)
def upsert_profile(
    body: AthleteProfileIn,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> AthleteProfile:
    uid = uuid.UUID(user_id)
    row = db.query(AthleteProfile).filter(AthleteProfile.user_id == uid).first()
    if row is None:
        row = AthleteProfile(user_id=uid)
        db.add(row)
    for field, value in body.model_dump().items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row
