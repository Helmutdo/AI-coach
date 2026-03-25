# garmin-trainer

API FastAPI + Next.js (coach IA, Garmin, Strava).

## Desarrollo local (un solo comando)

Desde esta carpeta (`garmin-trainer/`):

```bash
npm run dev
```

Esto libera los puertos **8000**, **3000** y **3001** (procesos previos de uvicorn/next en esos puertos), arranca **FastAPI** en `http://127.0.0.1:8000` y **Next.js** en `http://localhost:3000`.

Requisitos: Python 3 con `venv` en `backend/.venv` (opcional; el script puede instalar deps), `fuser` o `lsof` (Linux) para liberar puertos.

Alternativa manual: terminal 1 — `cd backend && uvicorn main:app --reload --host 127.0.0.1 --port 8000`; terminal 2 — `cd frontend && npm run dev`.
