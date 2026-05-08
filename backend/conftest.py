"""Root conftest: set test env vars before any module-level import runs."""

from __future__ import annotations

import os

# Must happen before database.py is imported (engine created at module level).
os.environ.setdefault("DATABASE_URL", "sqlite:///./test.db")
os.environ.setdefault("OPEN_ROUTER_APIKEY", "test-key-placeholder")
os.environ.setdefault("ENCRYPTION_KEY", "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU=")
