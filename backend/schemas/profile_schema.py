"""Pydantic schemas for athlete profile endpoints."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class AthleteProfileIn(BaseModel):
    sex: str = Field(..., pattern="^(male|female|other)$")
    birth_year: int = Field(..., ge=1940, le=2010)
    weight_kg: float = Field(..., gt=0, le=300)
    height_cm: float = Field(..., gt=0, le=300)
    injuries: str = Field(..., min_length=1, max_length=2000)
    hours_per_week: Optional[float] = Field(None, ge=0, le=100)
    experience: Optional[str] = Field(None, pattern="^(beginner|amateur|competitive)$")
    years_in_triathlon: Optional[int] = Field(None, ge=0, le=50)
    target_distance: Optional[str] = Field(None, pattern="^(sprint|olympic|70\\.3|ironman)$")
    primary_goal: Optional[str] = Field(None, pattern="^(finish|time_goal|fitness|weight)$")
    next_race_date: Optional[str] = Field(None, max_length=128)


class AthleteProfileOut(AthleteProfileIn):
    model_config = {"from_attributes": True}
