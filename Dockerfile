# Monorepo: API FastAPI vive en /backend
FROM python:3.12-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

ENV PYTHONUNBUFFERED=1

# Railway inyecta PORT
CMD sh -c "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"
