"""POST /api/users/me — mismo contrato que usa NextAuth tras Google login."""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app


def test_post_users_me_creates_and_updates():
    gid = "test-google-e2e-unique-id"
    with TestClient(app) as client:
        r1 = client.post(
            "/api/users/me",
            json={
                "google_id": gid,
                "email": "e2e@example.com",
                "name": "E2E User",
                "avatar_url": "https://example.com/a.png",
            },
        )
        assert r1.status_code == 200
        d1 = r1.json()
        assert d1["google_id"] == gid
        assert d1["email"] == "e2e@example.com"
        assert d1["name"] == "E2E User"
        assert d1["avatar_url"] == "https://example.com/a.png"
        uid = d1["id"]
        assert len(uid) > 0

        r2 = client.post(
            "/api/users/me",
            json={
                "google_id": gid,
                "email": "updated@example.com",
                "name": "E2E Updated",
                "avatar_url": None,
            },
        )
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["id"] == uid
        assert d2["email"] == "updated@example.com"
        assert d2["name"] == "E2E Updated"
        assert d2["avatar_url"] is None


def test_post_users_me_rejects_empty_google_id():
    with TestClient(app) as client:
        r = client.post(
            "/api/users/me",
            json={
                "google_id": "",
                "email": "x@y.com",
                "name": "x",
                "avatar_url": None,
            },
        )
        assert r.status_code == 422
