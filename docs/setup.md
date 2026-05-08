# Setup Guide

## Prerequisites

- Python 3.10+ (with `venv` at `backend/.venv`)
- Node.js 18+
- `fuser` or `lsof` (port management in dev script)

## Manual Startup

```bash
# Terminal 1: Backend
cd backend && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Terminal 2: Frontend
cd frontend && npm install && npm run dev
```

## Environment Variables

### `backend/.env`

```env
DATABASE_URL=postgresql://user:password@host:5432/postgres
ENCRYPTION_KEY=          # python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
OPEN_ROUTER_APIKEY=      # https://openrouter.ai/keys
CORS_ORIGINS=http://localhost:3000

# Strava OAuth (optional)
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_REDIRECT_URI=http://127.0.0.1:8000/api/strava/callback
STRAVA_FRONTEND_REDIRECT=http://localhost:3000/settings
```

### `frontend/.env.local`

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
AUTH_SECRET=             # openssl rand -base64 32
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

## Google OAuth Setup

1. [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create OAuth 2.0 Client ID → Web Application
3. Authorized JavaScript origins: `http://localhost:3000`
4. Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google`
5. If app is in Testing mode, add your Gmail to Test Users

## Strava OAuth Setup

1. [strava.com/settings/api](https://www.strava.com/settings/api) → create app
2. Set Authorization Callback Domain to your backend host
3. Add `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REDIRECT_URI` to `backend/.env`

## Production Deployment

| Service | Platform |
|---------|----------|
| Frontend | Vercel — root directory: `frontend` |
| Backend | Render — root directory: `backend`, runtime: Docker |
| Database | Neon (free PostgreSQL) |

### Production env vars (Render)

```env
DATABASE_URL=<neon connection string>
ENVIRONMENT=production
OPEN_ROUTER_APIKEY=
ENCRYPTION_KEY=
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_REDIRECT_URI=https://<render-domain>/api/strava/callback
STRAVA_FRONTEND_REDIRECT=https://<vercel-domain>/settings
CORS_ORIGINS=https://<vercel-domain>
```

### Production env vars (Vercel)

```env
NEXT_PUBLIC_API_URL=https://<render-domain>
AUTH_SECRET=
NEXTAUTH_URL=https://<vercel-domain>
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```
