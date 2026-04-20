# Garmin Trainer — AI Endurance Coach

> Full-stack sports analytics platform for endurance athletes. Sync your Garmin & Strava data, then chat with an AI coach that actually knows your training.

![Dashboard](img_post_beta/dashboard_ai_trainer_helmut_schweitzer.jpeg)

---

## Features

- **AI Coach** — Chat with Claude, GPT-4o, or Gemini with full context of your last 90 days of training
- **Garmin Sync** — Activities, daily metrics, HRV, sleep, body battery, VO2max
- **Strava Integration** — OAuth sync with power, pace, and suffer score
- **Performance Management Chart** — CTL, ATL, TSB (fitness, fatigue, form)
- **HR Zone Distribution** — Weekly breakdown by sport type
- **Recovery Metrics** — Sleep score, resting HR, HRV status

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
| **Auth** | Google OAuth (NextAuth v5) |
| **AI** | Anthropic Claude · OpenAI GPT-4o · Google Gemini |
| **Integrations** | Garmin Connect (Garth OAuth) · Strava API |
| **Security** | Fernet encryption for tokens, rate limiting via slowapi |

---

## Quick Start

```bash
# Clone and install
git clone <repo>
cd garmin-trainer
npm run dev
```

This frees ports 8000/3000, starts **FastAPI** on `http://127.0.0.1:8000` and **Next.js** on `http://localhost:3000`.

**Requirements:** Python 3 with `venv` at `backend/.venv`, Node.js 18+, `fuser`/`lsof` (Linux).

### Manual startup

```bash
# Terminal 1
cd backend && uvicorn main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2
cd frontend && npm run dev
```

---

## Environment Variables

**`backend/.env`**
```env
DATABASE_URL=sqlite:///./garmin_coach.db
ENCRYPTION_KEY=<fernet-key>
CORS_ORIGINS=http://localhost:3000
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_REDIRECT_URI=http://localhost:8000/api/strava/callback
ANTHROPIC_API_KEY=        # or configure per-user in Settings
OPENAI_API_KEY=
GOOGLE_API_KEY=
AI_PROVIDER=anthropic
```

**`frontend/.env.local`**
```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
AUTH_SECRET=
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

---

## API Reference

```
POST  /auth/garmin/login        Connect Garmin account
POST  /auth/ai/configure        Set AI provider + API key

POST  /garmin/sync              Sync activities & daily metrics
GET   /garmin/activities        List Garmin activities
GET   /garmin/daily-metrics     Sleep, stress, HRV, body battery
GET   /garmin/summary           Weekly/monthly summary

GET   /strava/connect           OAuth redirect URL
POST  /strava/sync              Sync last 60 days

POST  /coach/chat               Chat with AI coach
GET   /coach/analysis           Auto analysis (7/30/90 days)
GET   /coach/history            Conversation history
```

---

## Project Structure

```
garmin-trainer/
├── backend/
│   ├── main.py
│   ├── models/models.py
│   ├── routers/           # auth, users, garmin, strava, coach
│   └── services/          # garmin, strava, sync, ai
└── frontend/
    └── app/
        ├── dashboard/     # Charts & metrics
        ├── coach/         # AI chat
        ├── activities/    # Activity list
        └── settings/      # Garmin / Strava / AI config
```

---

## How It Works

1. **Login** with Google OAuth
2. **Connect** Garmin and/or Strava in Settings
3. **Sync** your activities and daily metrics
4. **Chat** with the AI coach — it has full context of your training load, sleep, HRV, and recent workouts
5. **Analyze** your PMC, zone distribution, and recovery trends on the dashboard
