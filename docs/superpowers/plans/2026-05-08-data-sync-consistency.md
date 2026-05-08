# Data Sync Consistency Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix data-loading bugs so CSV activities persist across navigation, Strava activities appear after sync, dashboard banners clear automatically, and dashboard gains 6M/1Y/All time filters.

**Architecture:** Add `has_data: bool` to garmin status backend endpoint (counts GarminActivity rows); propagate through api.ts → appStore `hasGarminData` → TopBar. Activities page removes its CSV upload and its broken garmin fetch guard. Dashboard expands DateRange and reads `hasGarminData` from store to auto-hide banners.

**Tech Stack:** FastAPI + SQLAlchemy (backend), Next.js 14 App Router + TypeScript + Zustand (frontend).

---

## File Map

| File | Change |
|------|--------|
| `backend/routers/auth_router.py` | Add `has_data` field to `GET /api/garmin/status` response |
| `backend/tests/test_garmin_status.py` | New: tests for `has_data` field |
| `frontend/lib/api.ts` | Add `has_data` to `GarminStatusResponse` |
| `frontend/store/appStore.ts` | Add `hasGarminData`, update `setStatusFromApi` + `hasFitnessSource` |
| `frontend/components/TopBar.tsx` | Pass `g.has_data` as `garminHasData` to `setStatusFromApi` |
| `frontend/components/garmin/GarminCSVUpload.tsx` | After upload: clear localStorage flags, call `getGarminStatus` + update store |
| `frontend/app/(app)/activities/page.tsx` | Remove CSV upload, remove garmin fetch guard, fix Strava error, change default period to `"all"` |
| `frontend/app/(app)/dashboard/page.tsx` | Expand DateRange to 180/365/0, fix banner logic, fix loadData for new ranges |

---

### Task 1: Backend — add `has_data` to garmin status

**Files:**
- Modify: `backend/routers/auth_router.py:88-113`
- Create: `backend/tests/test_garmin_status.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_garmin_status.py
"""Tests for GET /api/garmin/status has_data field."""
from __future__ import annotations

import uuid
import pytest
from fastapi.testclient import TestClient

from dependencies.auth import get_current_user_id
from main import app
from database.database import get_db
from models.models import GarminActivity
from datetime import datetime, timezone


@pytest.fixture
def test_user_id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def client_with_auth(test_user_id: str):
    def override() -> str:
        return test_user_id
    app.dependency_overrides[get_current_user_id] = override
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


def test_garmin_status_has_data_false_when_no_activities(client_with_auth):
    r = client_with_auth.get("/api/auth/garmin/status")
    assert r.status_code == 200
    data = r.json()
    assert "has_data" in data
    assert data["has_data"] is False


def test_garmin_status_has_data_true_after_csv_import(client_with_auth, test_user_id):
    uid = uuid.UUID(test_user_id)
    # Insert a garmin activity directly
    db_gen = get_db()
    db = next(db_gen)
    try:
        act = GarminActivity(
            user_id=uid,
            activity_id="csv_test_001",
            activity_name="Test Run",
            activity_type="Running",
            start_time=datetime(2026, 1, 1, tzinfo=timezone.utc),
            synced_at=datetime.now(timezone.utc),
            raw_data={"source": "csv"},
        )
        db.add(act)
        db.commit()
    finally:
        try:
            next(db_gen)
        except StopIteration:
            pass

    r = client_with_auth.get("/api/auth/garmin/status")
    assert r.status_code == 200
    assert r.json()["has_data"] is True
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/test_garmin_status.py -v
```
Expected: FAIL — `has_data` key missing from response.

- [ ] **Step 3: Add `has_data` to the endpoint**

In `backend/routers/auth_router.py`, add import at top:
```python
from sqlalchemy import func
```

Replace the `garmin_status` function body (keep signature, change return dict):

```python
@router.get("/garmin/status")
def garmin_status(
    request: Request,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    uid = uuid.UUID(user_id)
    ts = user_tokenstore(uid)
    tokens_disk = oauth_tokens_present(ts)
    row = db.query(UserSettings).filter(UserSettings.user_id == uid).first()
    tokens_db = bool(row and row.garmin_token_encrypted)
    tokens = tokens_disk or tokens_db
    active = (
        bool(getattr(request.app.state, "garmin_session_active", False)) or tokens
    )
    garmin_email: str | None = None
    if row and (row.garmin_email or "").strip() not in ("", "not-configured@local"):
        garmin_email = (row.garmin_email or "").strip()

    from models.models import GarminActivity as _GA
    count = (
        db.query(func.count(_GA.id))
        .filter(_GA.user_id == uid)
        .scalar()
        or 0
    )

    return {
        "active": active,
        "oauth_tokens_present": tokens,
        "garmin_email": garmin_email if active else None,
        "has_data": count > 0,
    }
```

- [ ] **Step 4: Run tests**

```bash
cd backend && python -m pytest tests/test_garmin_status.py -v
```
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routers/auth_router.py backend/tests/test_garmin_status.py
git commit -m "feat: add has_data to garmin status endpoint"
```

---

### Task 2: Frontend — api.ts + appStore add hasGarminData

**Files:**
- Modify: `frontend/lib/api.ts:60-65`
- Modify: `frontend/store/appStore.ts`

- [ ] **Step 1: Update `GarminStatusResponse` in api.ts**

```typescript
// frontend/lib/api.ts — replace existing GarminStatusResponse type
export type GarminStatusResponse = {
  active: boolean;
  oauth_tokens_present: boolean;
  garmin_email: string | null;
  has_data: boolean;
};
```

- [ ] **Step 2: Update appStore.ts**

Replace entire file content:

```typescript
import { create } from "zustand";

export type AppStore = {
  garminConnected: boolean;
  hasGarminData: boolean;
  stravaConnected: boolean;
  stravaOAuthConfigured: boolean;
  stravaAthleteName: string | null;
  aiConfigured: boolean;
  onboardingComplete: boolean;
  aiProvider: string | null;
  lastSync: Date | null;
  userId: string | null;
  setGarminConnected: (v: boolean) => void;
  setAiConfigured: (v: boolean) => void;
  setOnboardingComplete: (v: boolean) => void;
  setAiProvider: (v: string | null) => void;
  setLastSync: (d: Date | null) => void;
  setUserId: (id: string | null) => void;
  setStatusFromApi: (g: {
    garminActive: boolean;
    garminHasData: boolean;
    stravaConnected: boolean;
    stravaOAuthConfigured?: boolean;
    stravaAthleteName: string | null;
    aiConfigured: boolean;
    aiProvider: string | null;
  }) => void;
};

function hasFitnessSource(g: {
  garminConnected: boolean;
  hasGarminData: boolean;
  stravaConnected: boolean;
}) {
  return g.garminConnected || g.hasGarminData || g.stravaConnected;
}

export const useAppStore = create<AppStore>((set, get) => ({
  garminConnected: false,
  hasGarminData: false,
  stravaConnected: false,
  stravaOAuthConfigured: true,
  stravaAthleteName: null,
  aiConfigured: false,
  onboardingComplete: false,
  aiProvider: null,
  lastSync: null,
  userId: null,
  setGarminConnected: (v) =>
    set({
      garminConnected: v,
      onboardingComplete:
        hasFitnessSource({
          garminConnected: v,
          hasGarminData: get().hasGarminData,
          stravaConnected: get().stravaConnected,
        }) && get().aiConfigured,
    }),
  setAiConfigured: (v) =>
    set({
      aiConfigured: v,
      onboardingComplete:
        hasFitnessSource({
          garminConnected: get().garminConnected,
          hasGarminData: get().hasGarminData,
          stravaConnected: get().stravaConnected,
        }) && v,
    }),
  setOnboardingComplete: (v) => set({ onboardingComplete: v }),
  setAiProvider: (v) => set({ aiProvider: v }),
  setLastSync: (d) => set({ lastSync: d }),
  setUserId: (id) => set({ userId: id }),
  setStatusFromApi: ({
    garminActive,
    garminHasData,
    stravaConnected,
    stravaOAuthConfigured,
    stravaAthleteName,
    aiConfigured,
    aiProvider,
  }) =>
    set({
      garminConnected: garminActive,
      hasGarminData: garminHasData,
      stravaConnected,
      stravaOAuthConfigured: stravaOAuthConfigured ?? true,
      stravaAthleteName,
      aiConfigured,
      aiProvider,
      onboardingComplete:
        hasFitnessSource({
          garminConnected: garminActive,
          hasGarminData: garminHasData,
          stravaConnected,
        }) && aiConfigured,
    }),
}));
```

- [ ] **Step 3: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```
Expected: errors only in files that call `setStatusFromApi` without `garminHasData` — those get fixed in Tasks 3 and 4.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts frontend/store/appStore.ts
git commit -m "feat: add hasGarminData to appStore and GarminStatusResponse"
```

---

### Task 3: TopBar — pass garminHasData to store

**Files:**
- Modify: `frontend/components/TopBar.tsx`

- [ ] **Step 1: Update setStatusFromApi call in TopBar**

In `frontend/components/TopBar.tsx`, update the `setStatusFromApi` call inside the `useEffect`:

```typescript
setStatusFromApi({
  garminActive: g.active,
  garminHasData: g.has_data,
  stravaConnected: st.connected,
  stravaOAuthConfigured: st.oauth_configured ?? true,
  stravaAthleteName: st.athlete_name,
  aiConfigured: ai.configured,
  aiProvider: ai.provider ?? null,
});
```

Also update the error fallback:
```typescript
setStatusFromApi({
  garminActive: false,
  garminHasData: false,
  stravaConnected: false,
  stravaAthleteName: null,
  aiConfigured: false,
  aiProvider: null,
});
```

- [ ] **Step 2: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep TopBar
```
Expected: no errors for TopBar.

- [ ] **Step 3: Find and fix all other callers of setStatusFromApi**

```bash
grep -rn "setStatusFromApi" frontend/
```

Update every call site that's missing `garminHasData` — add `garminHasData: false` as safe default for callers that don't have the garmin status response available (e.g., onboarding page).

- [ ] **Step 4: Full TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```
Expected: no output (no errors).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/TopBar.tsx
git commit -m "feat: propagate garminHasData through TopBar to store"
```

---

### Task 4: GarminCSVUpload — clear localStorage + refresh status

**Files:**
- Modify: `frontend/components/garmin/GarminCSVUpload.tsx`

- [ ] **Step 1: Update component to refresh store after upload**

Replace the full file content:

```typescript
"use client";

import { useState } from "react";
import { getGarminStatus, uploadGarminCSV } from "@/lib/api";
import { useAppStore } from "@/store/appStore";

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className ?? "h-5 w-5"}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export type GarminCSVUploadProps = {
  onUploaded?: () => void | Promise<void>;
};

export function GarminCSVUpload({ onUploaded }: GarminCSVUploadProps) {
  const setStatusFromApi = useAppStore((s) => s.setStatusFromApi);
  const stravaConnected = useAppStore((s) => s.stravaConnected);
  const stravaAthleteName = useAppStore((s) => s.stravaAthleteName);
  const aiConfigured = useAppStore((s) => s.aiConfigured);
  const aiProvider = useAppStore((s) => s.aiProvider);
  const stravaOAuthConfigured = useAppStore((s) => s.stravaOAuthConfigured);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    inserted: number;
    skipped: number;
    errors: string[];
    skip_reasons?: { already_imported: number; api_duplicate: number; bad_date: number; empty_row: number };
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleFile(file: File) {
    setLoading(true);
    setErr(null);
    setResult(null);
    try {
      const res = await uploadGarminCSV(file);
      setResult({ inserted: res.inserted, skipped: res.skipped, errors: res.errors ?? [], skip_reasons: res.skip_reasons });
      await onUploaded?.();

      // Clear dashboard onboarding banner flags so it auto-hides
      try {
        localStorage.removeItem("onboarding_skipped_garmin");
        localStorage.removeItem("banner_dismissed_garmin");
      } catch { /* ignore */ }

      // Refresh garmin status in global store so hasGarminData updates immediately
      try {
        const g = await getGarminStatus();
        setStatusFromApi({
          garminActive: g.active,
          garminHasData: g.has_data,
          stravaConnected,
          stravaOAuthConfigured,
          stravaAthleteName,
          aiConfigured,
          aiProvider,
        });
      } catch { /* ignore — store update is best-effort */ }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500">
        Export from{" "}
        <span className="text-zinc-400">Garmin Connect → Activities → Export CSV</span>, then
        upload here.
      </p>

      <input
        type="file"
        accept=".csv"
        className="hidden"
        id="garmin-csv-input"
        onChange={onChange}
        disabled={loading}
      />

      <label
        htmlFor="garmin-csv-input"
        className={`inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 ${loading ? "pointer-events-none opacity-50" : ""}`}
      >
        {loading && <Spinner className="h-4 w-4 text-zinc-300" />}
        {loading ? "Uploading…" : "Upload CSV"}
      </label>

      {result && (
        <div className="space-y-1">
          <p className={`text-sm ${result.inserted > 0 ? "text-emerald-400" : "text-zinc-400"}`}>
            {result.inserted} activities imported, {result.skipped} skipped.
          </p>
          {result.skipped > 0 && result.skip_reasons && (
            <ul className="text-xs text-zinc-500 space-y-0.5 pl-2">
              {result.skip_reasons.already_imported > 0 && (
                <li>· {result.skip_reasons.already_imported} already imported (duplicates)</li>
              )}
              {result.skip_reasons.api_duplicate > 0 && (
                <li>· {result.skip_reasons.api_duplicate} matched Garmin API activity</li>
              )}
              {result.skip_reasons.bad_date > 0 && (
                <li>· {result.skip_reasons.bad_date} bad date format</li>
              )}
              {result.skip_reasons.empty_row > 0 && (
                <li>· {result.skip_reasons.empty_row} empty rows</li>
              )}
            </ul>
          )}
          {result.errors.length > 0 && (
            <ul className="text-xs text-amber-400 space-y-0.5 pl-2">
              {result.errors.slice(0, 5).map((e, i) => <li key={i}>· {e}</li>)}
            </ul>
          )}
        </div>
      )}
      {err && <p className="text-sm text-red-400">{err}</p>}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep GarminCSV
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/garmin/GarminCSVUpload.tsx
git commit -m "feat: refresh garmin status and clear banners after CSV upload"
```

---

### Task 5: Activities page — remove CSV upload, fix fetch guard

**Files:**
- Modify: `frontend/app/(app)/activities/page.tsx`

- [ ] **Step 1: Replace the file**

Replace full file content. Key changes from current:
- Remove `uploadGarminCSV` import, `useRef`, `csvUploading`/`csvMsg` state, `fileInputRef`, `handleCSVUpload` function, CSV upload JSX block and result banner.
- Remove `if (garminConnected !== false)` guard — always fetch garmin.
- Fix Strava `.catch(() => {})` → `.catch((e) => setErr(e instanceof Error ? e.message : "Failed to load Strava activities"))`.
- Change default period from `"30d"` to `"all"`.
- Remove `garminConnected` from store destructure (no longer needed).

```typescript
"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  getGarminActivities,
  getStravaActivities,
  type GarminActivityRow,
  type StravaActivityRow,
} from "@/lib/api";
import { useAppStore } from "@/store/appStore";
import { getSportColor } from "@/lib/sportColors";

type UnifiedActivity =
  | { source: "garmin" | "csv"; data: GarminActivityRow }
  | { source: "strava"; data: StravaActivityRow };

type Period = "30d" | "90d" | "6m" | "1y" | "all";

const PERIODS: { value: Period; label: string; days: number; limit: number }[] = [
  { value: "30d", label: "30 days", days: 30, limit: 150 },
  { value: "90d", label: "3 months", days: 90, limit: 250 },
  { value: "6m", label: "6 months", days: 180, limit: 400 },
  { value: "1y", label: "1 year", days: 365, limit: 700 },
  { value: "all", label: "All time", days: 0, limit: 1000 },
];

function fmtDuration(sec: number | null) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return `${m}m`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function fmtDist(meters: number | null) {
  if (meters == null || meters === 0) return "—";
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function getDate(u: UnifiedActivity): string {
  return u.source === "strava" ? u.data.start_date : (u.data.start_time ?? "");
}

function getType(u: UnifiedActivity): string {
  return u.source === "strava" ? u.data.sport_type : (u.data.activity_type ?? "—");
}

function getName(u: UnifiedActivity): string {
  return u.source === "strava" ? u.data.name : (u.data.activity_name ?? "—");
}

function getDuration(u: UnifiedActivity): number | null {
  return u.source === "strava" ? u.data.moving_time : u.data.duration_seconds;
}

function getAvgHR(u: UnifiedActivity): number | null {
  return u.source === "strava" ? u.data.avg_heartrate : u.data.avg_heart_rate;
}

function getDistance(u: UnifiedActivity): number | null {
  return u.source === "strava" ? u.data.distance : u.data.distance_meters;
}

function getId(u: UnifiedActivity): string {
  return u.source === "strava" ? u.data.id : String(u.data.id);
}

function SourceBadge({ source }: { source: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    garmin: { label: "Garmin", cls: "bg-emerald-900/50 text-emerald-300" },
    strava: { label: "Strava", cls: "bg-orange-900/50 text-orange-300" },
    csv: { label: "CSV", cls: "bg-violet-900/50 text-violet-300" },
  };
  const { label, cls } = cfg[source] ?? { label: source, cls: "bg-zinc-800 text-zinc-400" };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
  );
}

export default function ActivitiesPage() {
  const userId = useAppStore((s) => s.userId);
  const stravaConnected = useAppStore((s) => s.stravaConnected);

  const [period, setPeriod] = useState<Period>("all");
  const [garminRows, setGarminRows] = useState<GarminActivityRow[]>([]);
  const [stravaRows, setStravaRows] = useState<StravaActivityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "garmin" | "csv" | "strava">("all");

  const periodCfg = PERIODS.find((p) => p.value === period) ?? PERIODS[PERIODS.length - 1];

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    setErr(null);
    const fetches: Promise<void>[] = [
      getGarminActivities({ limit: periodCfg.limit, days: periodCfg.days })
        .then(setGarminRows)
        .catch(() => {}),
    ];
    if (stravaConnected) {
      fetches.push(
        getStravaActivities({ limit: periodCfg.limit, days: periodCfg.days })
          .then(setStravaRows)
          .catch((e) => setErr(e instanceof Error ? e.message : "Failed to load Strava activities")),
      );
    }
    Promise.all(fetches).finally(() => setLoading(false));
  }, [userId, stravaConnected, periodCfg.days, periodCfg.limit]);

  const unified: UnifiedActivity[] = useMemo(() => {
    const out: UnifiedActivity[] = [
      ...garminRows.map((d) => ({
        source: (d.source === "csv" ? "csv" : "garmin") as "garmin" | "csv",
        data: d,
      })),
      ...stravaRows.map((d) => ({ source: "strava" as const, data: d })),
    ];
    out.sort((a, b) => getDate(b).localeCompare(getDate(a)));
    return out;
  }, [garminRows, stravaRows]);

  const types = useMemo(() => {
    const s = new Set<string>();
    for (const u of unified) s.add(getType(u));
    return Array.from(s).sort();
  }, [unified]);

  const filtered = useMemo(() => {
    return unified.filter((u) => {
      if (sourceFilter !== "all" && u.source !== sourceFilter) return false;
      if (typeFilter !== "all" && getType(u) !== typeFilter) return false;
      return true;
    });
  }, [unified, typeFilter, sourceFilter]);

  const csvCount = garminRows.filter((r) => r.source === "csv").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Activities</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {garminRows.filter(r => r.source !== "csv").length} Garmin
            {csvCount > 0 && ` · ${csvCount} CSV`}
            {" "}· {stravaRows.length} Strava
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="period-filter" className="text-sm text-zinc-500">Period</label>
            <select
              id="period-filter"
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            >
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="source-filter" className="text-sm text-zinc-500">Source</label>
            <select
              id="source-filter"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as typeof sourceFilter)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            >
              <option value="all">All</option>
              <option value="garmin">Garmin</option>
              <option value="csv">CSV</option>
              <option value="strava">Strava</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="type-filter" className="text-sm text-zinc-500">Type</label>
            <select
              id="type-filter"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            >
              <option value="all">All</option>
              {types.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {err}
        </div>
      )}

      {loading && (
        <div className="py-4 text-center text-sm text-zinc-500">Loading activities…</div>
      )}

      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-900/80 text-xs uppercase text-zinc-500">
            <tr>
              <th className="w-10 px-3 py-3" />
              <th className="px-3 py-3">Date</th>
              <th className="px-3 py-3">Source</th>
              <th className="px-3 py-3">Type</th>
              <th className="px-3 py-3">Duration</th>
              <th className="px-3 py-3">Distance</th>
              <th className="px-3 py-3">Avg HR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {filtered.map((u) => {
              const id = getId(u);
              const open = expanded === id;
              const sportColor = getSportColor(getType(u));
              return (
                <Fragment key={id}>
                  <tr
                    className="cursor-pointer bg-zinc-950/50 hover:bg-zinc-900/80"
                    style={{ borderLeft: `3px solid ${sportColor.dot}` }}
                    onClick={() => setExpanded(open ? null : id)}
                  >
                    <td className="px-3 py-3 text-zinc-500">{open ? "▼" : "▶"}</td>
                    <td className="px-3 py-3 text-zinc-300">{fmtDate(getDate(u))}</td>
                    <td className="px-3 py-3">
                      <SourceBadge source={u.source} />
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{ background: `${sportColor.dot}22`, color: sportColor.dot }}
                      >
                        {getType(u)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-zinc-300">{fmtDuration(getDuration(u))}</td>
                    <td className="px-3 py-3 text-zinc-300">{fmtDist(getDistance(u))}</td>
                    <td className="px-3 py-3 text-zinc-300">{getAvgHR(u) ?? "—"}</td>
                  </tr>
                  {open && (
                    <tr key={`${id}-detail`} className="bg-zinc-900/40">
                      <td colSpan={7} className="px-4 py-4 text-xs text-zinc-400">
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          <div><span className="text-zinc-500">Name: </span>{getName(u)}</div>
                          {u.source === "strava" ? (
                            <>
                              <div><span className="text-zinc-500">Suffer score: </span>{u.data.suffer_score ?? "—"}</div>
                              <div><span className="text-zinc-500">Elevation gain: </span>{u.data.total_elevation_gain != null ? `${u.data.total_elevation_gain.toFixed(0)} m` : "—"}</div>
                              <div><span className="text-zinc-500">Max HR: </span>{u.data.max_heartrate ?? "—"}</div>
                              <div><span className="text-zinc-500">Avg power: </span>{u.data.avg_watts != null ? `${u.data.avg_watts.toFixed(0)} W` : "—"}</div>
                              <div><span className="text-zinc-500">PRs: </span>{u.data.pr_count ?? "—"}</div>
                              <div>
                                <a
                                  href={`https://www.strava.com/activities/${u.data.strava_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-bold text-[#FC5200] underline"
                                >
                                  View on Strava
                                </a>
                              </div>
                            </>
                          ) : (
                            <>
                              <div><span className="text-zinc-500">Training load: </span>{u.data.training_load?.toFixed(1) ?? "—"}</div>
                              <div><span className="text-zinc-500">Aerobic effect: </span>{u.data.aerobic_effect?.toFixed(2) ?? "—"}</div>
                              <div><span className="text-zinc-500">Max HR: </span>{u.data.max_heart_rate ?? "—"}</div>
                              <div><span className="text-zinc-500">Calories: </span>{u.data.calories ?? "—"}</div>
                            </>
                          )}
                          <div><span className="text-zinc-500">Synced: </span>{fmtDate(u.data.synced_at)}</div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {stravaRows.length > 0 && (
          <p className="mt-2 px-1 text-xs text-zinc-600">Compatible with Strava</p>
        )}
        {!loading && filtered.length === 0 && !err && (
          <div className="flex flex-col items-center gap-4 px-4 py-16 text-center">
            {unified.length === 0 ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-10 w-10 text-zinc-600">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <p className="text-sm font-medium text-zinc-300">No training data yet</p>
                <p className="text-sm text-zinc-500">Upload a Garmin CSV or connect Strava in Settings.</p>
                <a
                  href="/settings"
                  className="mt-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
                >
                  Go to Settings →
                </a>
              </>
            ) : (
              <p className="text-sm text-zinc-500">No activities match the current filters.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep activities
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/\(app\)/activities/page.tsx
git commit -m "fix: always fetch garmin activities, remove inline CSV upload, default period all"
```

---

### Task 6: Dashboard — expand DateRange + fix banners

**Files:**
- Modify: `frontend/app/(app)/dashboard/page.tsx:63` (DateRange type)
- Modify: `frontend/app/(app)/dashboard/page.tsx:113` (daysAgo)
- Modify: `frontend/app/(app)/dashboard/page.tsx:1117` (dateRange state)
- Modify: `frontend/app/(app)/dashboard/page.tsx:1128-1142` (loadData)
- Modify: `frontend/app/(app)/dashboard/page.tsx:1153` (cutoff)
- Modify: `frontend/app/(app)/dashboard/page.tsx:1186` (prevCutoff)
- Modify: `frontend/app/(app)/dashboard/page.tsx:1371-1383` (date range buttons)
- Modify: `frontend/app/(app)/dashboard/page.tsx:440-467` (OnboardingBanners)

- [ ] **Step 1: Expand DateRange type (line 63)**

```typescript
// Replace:
type DateRange  = 7 | 30 | 90;
// With:
type DateRange  = 7 | 30 | 90 | 180 | 365 | 0;
```

- [ ] **Step 2: Fix cutoff for dateRange=0 (line 1153)**

```typescript
// Replace:
const cutoff = useMemo(() => daysAgo(dateRange), [dateRange]);
// With:
const cutoff = useMemo(() => (dateRange === 0 ? new Date(0) : daysAgo(dateRange)), [dateRange]);
```

- [ ] **Step 3: Fix prevCutoff for dateRange=0 (line 1186)**

Find in the `kpis` useMemo:
```typescript
// Replace:
const prevCutoff = daysAgo(dateRange * 2);
// With:
const prevCutoff = dateRange === 0 ? new Date(0) : daysAgo(dateRange * 2);
```

- [ ] **Step 4: Update loadData to use dateRange**

`loadData` is a `useCallback`. Add `dateRange` as a parameter so it re-fetches when the range changes:

```typescript
// Replace loadData:
const loadData = useCallback(async () => {
  setLoading(true);
  try {
    const days = dateRange === 0 ? 0 : dateRange;
    const limit = dateRange === 0 ? 500 : Math.max(dateRange * 2, 100);
    const [g, s, m] = await Promise.all([
      getGarminActivities({ limit, days }).catch(() => [] as GarminActivityRow[]),
      getStravaActivities({ limit, days }).catch(() => [] as StravaActivityRow[]),
      getGarminDailyMetrics({ days: 42 }).catch(() => [] as DailyMetricRow[]),
    ]);
    setGarminActs(g);
    setStravaActs(s);
    setDailyMetrics(m);
  } finally {
    setLoading(false);
  }
}, [dateRange]);
```

- [ ] **Step 5: Update date range buttons (line ~1371)**

```typescript
// Replace the date range button group:
<div className="flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-1 gap-1">
  {(
    [
      { value: 7, label: "7d" },
      { value: 30, label: "30d" },
      { value: 90, label: "90d" },
      { value: 180, label: "6M" },
      { value: 365, label: "1Y" },
      { value: 0, label: "Todo" },
    ] as { value: DateRange; label: string }[]
  ).map(({ value, label }) => (
    <button
      key={value}
      onClick={() => setDateRange(value)}
      className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${
        dateRange === value
          ? "bg-zinc-700 text-zinc-100"
          : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {label}
    </button>
  ))}
</div>
```

- [ ] **Step 6: Fix OnboardingBanners to use hasGarminData from store (line ~440)**

```typescript
function OnboardingBanners() {
  const hasGarminData = useAppStore((s) => s.hasGarminData);
  const [showGarmin, setShowGarmin] = useState(false);
  const [showAI, setShowAI] = useState(false);

  useEffect(() => {
    try {
      setShowGarmin(
        !hasGarminData &&
        localStorage.getItem("onboarding_skipped_garmin") === "true" &&
        localStorage.getItem("banner_dismissed_garmin") !== "true",
      );
      setShowAI(
        localStorage.getItem("onboarding_skipped_ai") === "true" &&
        localStorage.getItem("banner_dismissed_ai") !== "true",
      );
    } catch { /* ignore */ }
  }, [hasGarminData]);

  function dismissGarmin() {
    try { localStorage.setItem("banner_dismissed_garmin", "true"); } catch { /* ignore */ }
    setShowGarmin(false);
  }

  function dismissAI() {
    try { localStorage.setItem("banner_dismissed_ai", "true"); } catch { /* ignore */ }
    setShowAI(false);
  }

  if (!showGarmin && !showAI) return null;
  // ... rest of JSX unchanged
```

- [ ] **Step 7: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/\(app\)/dashboard/page.tsx
git commit -m "feat: expand dashboard date range to 6M/1Y/All, fix banner auto-hide"
```

---

### Task 7: Final check + push

- [ ] **Step 1: Run all backend tests**

```bash
cd backend && python -m pytest -v 2>&1 | tail -20
```
Expected: all pass.

- [ ] **Step 2: Full TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1
```
Expected: no output.

- [ ] **Step 3: Push**

```bash
git push origin main
```
