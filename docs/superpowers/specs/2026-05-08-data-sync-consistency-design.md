# Data Sync Consistency Fix — Design Spec

## Goal

Eliminate data-loading bugs and UX inconsistencies caused by fragmented sync state across Garmin CSV, Garmin API, and Strava sources.

## Root Causes

1. `garminConnected` flag represents Garmin OAuth, not "has garmin data" — CSV uploads go into `GarminActivity` table but `garminConnected = false` so activities are never fetched after navigation.
2. Activities page default period is 30 days; Strava sync covers 60 days back — activities 31–60 days old are invisible by default.
3. Dashboard "Connect Garmin" banner reads localStorage `onboarding_skipped_garmin`, which is never cleared after CSV upload.
4. Dashboard DateRange limited to 7/30/90 days — no 6M, 1Y, or all-time view.
5. CSV upload exists in both Activities page and Settings — inconsistent UX.
6. Strava fetch errors silently swallowed (`.catch(() => {})`).

---

## Architecture

### Backend

**`backend/routers/auth_router.py` — `GET /api/garmin/status`**

Add `has_data: bool` field: count of `GarminActivity` rows for user > 0. Independent of OAuth tokens. Returns `True` for CSV-only users.

```python
from sqlalchemy import func
count = db.query(func.count(GarminActivity.id)).filter(GarminActivity.user_id == uid).scalar() or 0
has_data = count > 0
```

No other backend changes.

### Frontend Store

**`frontend/store/appStore.ts`**

Add `hasGarminData: boolean` (default `false`). `setStatusFromApi` receives `garminHasData: boolean` and sets it. `onboardingComplete` uses `(hasGarminData || stravaConnected) && aiConfigured`.

### Frontend: TopBar

**`frontend/components/TopBar.tsx`**

Pass `g.has_data` as `garminHasData` to `setStatusFromApi`. No visual change.

### Frontend: Activities Page

**`frontend/app/(app)/activities/page.tsx`**

- Remove inline CSV upload entirely (button, file input, state, handler).
- Remove `if (garminConnected !== false)` guard — always `fetch getGarminActivities`.
- Keep `if (stravaConnected)` guard for Strava (no point fetching if definitely not connected).
- Replace `.catch(() => {})` on Strava fetch with `.catch((e) => setErr(...))`.
- Change default period from `"30d"` to `"90d"`.
- Empty state when `unified.length === 0` and not loading: show "No training data yet — connect or upload in Settings" with a link to `/settings`.

### Frontend: Dashboard

**`frontend/app/(app)/dashboard/page.tsx`**

- Expand `DateRange` type: `7 | 30 | 90 | 180 | 365 | 0` (0 = all time).
- Add buttons: 6M (180), 1Y (365), Todo (0).
- `daysAgo(0)` returns epoch (Jan 1 2000) to effectively show all data.
- `OnboardingBanners`: additionally hide garmin banner when `hasGarminData === true` from store (not just localStorage check). User never needs to manually dismiss if data is present.

### Frontend: GarminCSVUpload

**`frontend/components/garmin/GarminCSVUpload.tsx`**

After successful upload (`inserted > 0` or even `skipped > 0`):
- `localStorage.removeItem("onboarding_skipped_garmin")`
- `localStorage.removeItem("banner_dismissed_garmin")`
- Call `getGarminStatus()` and `setStatusFromApi(...)` to update `hasGarminData` in store immediately.

Requires receiving `setStatusFromApi` as a prop or calling the store directly from the component.

---

## Data Flow After Fix

```
User uploads CSV
  → garmin_router stores rows in GarminActivity
  → GarminCSVUpload calls getGarminStatus()
  → garmin_status counts rows → has_data: true
  → setStatusFromApi({ garminHasData: true })
  → hasGarminData = true in store

User navigates to Activities
  → useEffect runs, always fetches getGarminActivities (no guard)
  → rows appear ✓
  → dashboard banner gone (hasGarminData = true) ✓

User connects Strava → syncs
  → stravaConnected = true in store
  → Activities fetches Strava (guard: stravaConnected)
  → default period 90d covers 60-day sync window ✓
```

---

## Out of Scope

- Consolidating Strava sync button location (stays in Settings and Dashboard)
- Garmin API (OAuth) multi-user sync — separate concern
- Real-time sync / websocket updates

---

## Files Modified

| File | Change |
|------|--------|
| `backend/routers/auth_router.py` | Add `has_data` to garmin status response |
| `frontend/store/appStore.ts` | Add `hasGarminData`, update `setStatusFromApi` |
| `frontend/components/TopBar.tsx` | Pass `g.has_data` to store |
| `frontend/app/(app)/activities/page.tsx` | Remove CSV upload, remove garmin guard, fix Strava error, change default period to 90d, fix empty state |
| `frontend/app/(app)/dashboard/page.tsx` | Expand DateRange, add 6M/1Y/All buttons, fix banner logic |
| `frontend/components/garmin/GarminCSVUpload.tsx` | Clear localStorage flags, refresh status after upload |
