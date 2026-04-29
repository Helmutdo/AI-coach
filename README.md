# AI-Coach — AI Endurance Coach

> Full-stack sports analytics platform for endurance athletes. Sync your Garmin & Strava data, then chat with an AI coach that actually knows your training history.

![Dashboard](img_post_beta/dashboard_ai_trainer_helmut_schweitzer.jpeg)

---

## Features

- **AI Coach** — Chat with Claude 3.5, GPT-4o, or Gemini with full context of your last 30-90 days of training.
- **Observability** — Built-in **Langfuse** integration to track AI traces and performance.
- **Garmin Sync** — Activities, daily metrics (HRV, sleep, body battery, VO2max).
- **Strava Integration** — OAuth sync with power, pace, and suffer score.
- **Performance Management Chart** — CTL, ATL, TSB (fitness, fatigue, form).
- **HR Zone Distribution** — Weekly breakdown by sport type.
- **Recovery Metrics** — Sleep score, resting HR, HRV status.

---

## Screenshots

| Dashboard | Activities |
|-----------|------------|
| ![Dashboard](img_post_beta/dashboard_2_ai_trainer_helmut_schweitzer.jpeg) | ![Activities](img_post_beta/activities_ai_trainer_helmut_schweitzer.jpeg) |

| AI Coach | Sync & Integrations |
|----------|---------------------|
| ![Coach](img_post_beta/ai_coach_ai_trainer_helmut_schweitzer.jpeg) | ![Sync](img_post_beta/sync_API_ai_trainer_helmut_schweitzer.jpeg) |

---

## Tech Stack

| Layer | Tech |
|-------|------|
| **Backend** | FastAPI + Uvicorn, SQLAlchemy, PostgreSQL/SQLite |
| **Frontend** | Next.js 14 (App Router), TypeScript, TailwindCSS |
| **Auth** | NextAuth v5 (Google OAuth) |
| **AI** | Anthropic (Claude) · OpenAI (GPT) · Google (Gemini) |
| **Observability**| **Langfuse** (Trace & Analytics) |
| **Integrations** | Garmin Connect (Garth OAuth) · Strava API |
| **Security** | Fernet encryption for tokens, rate limiting via slowapi |

---

## Quick Start

### Prerequisites

- **Python 3.10+** (with `venv` at `backend/.venv`)
- **Node.js 18+**
- **System tools:** `fuser` or `lsof` (to manage ports automatically)

### Installation & Run

```bash
# 1. Install dependencies and start both servers
npm run dev
```

This runs the automated `scripts/dev.sh` which:
1. Frees ports 8000 (Backend), 3000 (Frontend), and 3001 (optional dev).
2. Starts **FastAPI** on `http://127.0.0.1:8000`.
3. Starts **Next.js** on `http://localhost:3000`.

### Manual Startup

```bash
# Terminal 1: Backend
cd backend
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Terminal 2: Frontend
cd frontend
npm install
npm run dev
```

---

## Environment Variables

**`backend/.env`**
```env
DATABASE_URL=sqlite:///./garmin_coach.db
ENCRYPTION_KEY=<fernet-key>
CORS_ORIGINS=http://localhost:3000

# AI provider
AI_PROVIDER=anthropic   # anthropic | openai | google
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GOOGLE_API_KEY=...

# Strava OAuth (optional; required only if you want Strava)
STRAVA_CLIENT_ID=...
STRAVA_CLIENT_SECRET=...
# Local dev:
STRAVA_REDIRECT_URI=http://127.0.0.1:8000/api/strava/callback
STRAVA_FRONTEND_REDIRECT=http://localhost:3000/settings
```

**`frontend/.env.local`**
```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
AUTH_SECRET=...
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

---

## How It Works

1. **Login** with Google OAuth.
2. **Onboarding**: choose **Garmin** or **Strava** as your fitness source and connect it.
3. **Configure AI** provider key.
4. **Sync** your activities and daily metrics.
5. **Chat** with the AI coach — it has full context of your training load, sleep, HRV, and recent workouts.
6. **Analyze** your PMC, zone distribution, and recovery trends on the dashboard.

### Strava OAuth note

If you see `Strava OAuth is not configured (STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REDIRECT_URI)`, add those variables to `backend/.env` and restart `npm run dev`.

