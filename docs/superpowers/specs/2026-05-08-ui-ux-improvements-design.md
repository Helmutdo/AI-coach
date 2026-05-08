# UI/UX Improvements Design

**Date:** 2026-05-08  
**Status:** Approved

## Overview

Three sequential UI/UX improvements to make the app usable on mobile, more compelling to new visitors, and polished as a portfolio piece.

---

## Phase 1 — Mobile Navigation (Hybrid)

### Problem
Sidebar is `w-56 shrink-0` — invisible on mobile. App is unusable on phones.

### Solution: Responsive hybrid layout
- **Desktop (≥768px):** Existing sidebar unchanged.
- **Mobile (<768px):** Sidebar hidden (`hidden md:flex`), bottom tab bar shown (`md:hidden`).

### Components changed
- **`frontend/components/Sidebar.tsx`** — add `hidden md:flex` to aside element.
- **`frontend/components/AppShell.tsx`** — add bottom nav bar below main content area, visible only on mobile (`md:hidden`). 4 tabs: Dashboard, Activities, AI Coach, Settings — each with SVG icon + label. Active tab highlighted in emerald.

### Bottom nav spec
- Fixed at bottom, `z-50`, `border-t border-zinc-800 bg-zinc-950`
- 4 equal-width tabs, icon (20px) + label (10px) stacked vertically
- Active: `text-emerald-400`, icon filled. Inactive: `text-zinc-500`
- Icons: use inline SVG (no external icon library dependency)
  - Dashboard: grid squares
  - Activities: list/activity lines
  - Coach: chat bubble
  - Settings: gear/cog

---

## Phase 2 — Landing Page (Split Layout)

### Problem
`LandingSignIn.tsx` shows only title + Google button. No value proposition. New visitors don't understand what the app does.

### Solution: Two-column split layout
- **Left column:** Branding, tagline, 4 feature bullets, Google CTA
- **Right column:** Dashboard screenshot (`img_post_beta/dashboard_2_ai_trainer_helmut_schweitzer.jpeg`)
- **Mobile:** Single column stacked — left content on top, image below (or hidden on very small screens)

### Left column content
```
AI Coach
AI-powered endurance coaching for triathletes

✓ Chat with AI that knows your full training history
✓ Import from Garmin CSV or connect Strava
✓ Performance Management Chart (CTL/ATL/TSB)
✓ HRV, sleep, and recovery metrics

[Continue with Google]

Your data stays private and is never shared.
```

### Components changed
- **`frontend/components/LandingSignIn.tsx`** — full rewrite. No new files needed.
- Uses `next/image` for the screenshot with `priority` and appropriate `sizes`.

---

## Phase 3 — Polish

### 3a — Sidebar icons
- Add SVG icons to each nav link in `Sidebar.tsx`
- Same icons as bottom nav (grid, activity, chat bubble, cog)
- Fix title: `"AI Coach | Triatlon"` → `"AI Coach"`
- Fix subtitle: keep `"Training & recovery"`

### 3b — Empty states
Add empty state UI when no data is present.

**Dashboard (`app/(app)/dashboard/page.tsx`):**  
When activities array is empty, show centered card:
```
[Upload icon]
No training data yet
Upload a Garmin CSV or connect Strava to get started.
[→ Go to Settings]
```

**Activities page (`app/(app)/activities/page.tsx`):**  
Same pattern — detect empty activities list and show prompt instead of empty table.

---

## Out of Scope
- Skeleton loaders (separate improvement, lower priority)
- Dynamic coach suggestions based on data (backend change needed)
- Custom domain

## File Impact Summary

| File | Change |
|------|--------|
| `components/Sidebar.tsx` | Add `hidden md:flex`, icons, fix title |
| `components/AppShell.tsx` | Add mobile bottom nav |
| `components/LandingSignIn.tsx` | Full rewrite — split layout |
| `app/(app)/dashboard/page.tsx` | Add empty state |
| `app/(app)/activities/page.tsx` | Add empty state |
