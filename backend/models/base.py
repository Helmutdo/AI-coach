"""Declarative base lives in database.database; re-export for convenience."""

from database.database import Base

__all__ = ["Base"]
