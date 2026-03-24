"""Smoke tests: imports and trivial invariants for the scaffold."""

from __future__ import annotations


def test_import_backend_packages():
    import database.database  # noqa: F401
    import main  # noqa: F401
    import models.models  # noqa: F401
    import routers.auth_router  # noqa: F401
    import routers.coach_router  # noqa: F401
    import routers.garmin_router  # noqa: F401
    import routers.users_router  # noqa: F401
    import services.ai_service  # noqa: F401
    import services.garmin_service  # noqa: F401


def test_placeholder():
    assert True
