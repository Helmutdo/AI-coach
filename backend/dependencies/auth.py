"""Request auth: identifies the signed-in user via backend user id (UUID)."""

from __future__ import annotations

from fastapi import Header, HTTPException


def get_current_user_id(x_user_id: str | None = Header(None, alias="X-User-Id")) -> str:
    if not x_user_id or not str(x_user_id).strip():
        raise HTTPException(status_code=401, detail="X-User-Id header required")
    return str(x_user_id).strip()
