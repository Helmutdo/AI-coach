"""Fernet symmetric encryption for secrets at rest.

Generate a key once:
  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

Set ENCRYPTION_KEY in the environment (Railway, .env).
"""

from __future__ import annotations

import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv

_env_dir = Path(__file__).resolve().parent.parent
load_dotenv(_env_dir / ".env")


def _fernet() -> Fernet | None:
    key = (os.getenv("ENCRYPTION_KEY") or "").strip()
    if not key:
        return None
    return Fernet(key.encode("ascii"))


def encrypt(plaintext: str) -> str:
    """Encrypt UTF-8 plaintext; raises RuntimeError if ENCRYPTION_KEY is missing."""
    f = _fernet()
    if f is None:
        raise RuntimeError("ENCRYPTION_KEY is not set — cannot encrypt secrets")
    return f.encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt(ciphertext: str) -> str | None:
    """Decrypt Fernet ciphertext; returns None on any failure (never raises)."""
    if not ciphertext or not ciphertext.strip():
        return None
    f = _fernet()
    if f is None:
        return None
    try:
        return f.decrypt(ciphertext.strip().encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, UnicodeDecodeError):
        return None


def get_plaintext_api_key(stored: str | None) -> str | None:
    """
    Decrypt stored AI API key, or accept legacy plaintext rows.
    Returns None when not configured (empty, or literal 'unset').
    """
    if stored is None:
        return None
    s = stored.strip()
    if not s:
        return None
    plain = decrypt(s)
    if plain is not None:
        return None if plain == "unset" else plain
    if s == "unset":
        return None
    return s


def format_key_preview(plain: str) -> str:
    """Short preview: prefix hint + last 4 characters (never the full key)."""
    if len(plain) <= 4:
        return "****"
    tail = plain[-4:]
    if plain.startswith("sk-"):
        return f"sk-...{tail}"
    if plain.startswith("AIza"):
        return f"AIza...{tail}"
    return f"...{tail}"


def ai_key_preview_from_stored(stored: str | None) -> str | None:
    """Preview for API responses, or None if no key configured."""
    plain = get_plaintext_api_key(stored)
    if not plain:
        return None
    return format_key_preview(plain)
