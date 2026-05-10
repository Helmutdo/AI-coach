"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getCoachAnalysis,
  getGarminActivities,
  getGarminDailyMetrics,
  getStravaActivities,
  getStravaConnect,
  postGarminSync,
  postStravaSync,
  type CoachAnalysis,
  type DailyMetricRow,
  type GarminActivityRow,
  type StravaActivityRow,
} from "@/lib/api";
import { useAppStore } from "@/store/appStore";
import { getSportColor } from "@/lib/sportColors";

// ─── Constants ────────────────────────────────────────────────────────────────

const SPORT = {
  swim:  { bg: "#378ADD", text: "#0C447C", label: "Swim"  },
  bike:  { bg: "#EF9F27", text: "#633806", label: "Bike"  },
  run:   { bg: "#1D9E75", text: "#085041", label: "Run"   },
  other: { bg: "#6B7280", text: "#374151", label: "Other" },
} as const;

const CLR = {
  fresh:  "#1D9E75",
  warn:   "#BA7517",
  danger: "#E24B4A",
  brick:  "#7F77DD",
} as const;

const ZONE_COLORS = ["#93c5fd", "#60a5fa", "#f59e0b", "#f97316", "#ef4444"];
const DEFAULT_MAX_HR = 185;

const HRV_SCORE: Record<string, number> = {
  High: 90, Balanced: 75, Low: 50, Unbalanced: 45, Poor: 30,
};

// ─── Types ────────────────────────────────────────────────────────────────────

type SportType  = "swim" | "bike" | "run" | "other";
type DateRange  = 7 | 30 | 90 | 180 | 365 | 0;
type SportFilter = SportType | "all";

interface MergedActivity {
  id: string;
  date: string;
  dateTime: Date;
  sport: SportType;
  name: string;
  durationSec: number;
  distanceM: number;
  avgHR: number | null;
  maxHR: number | null;
  tss: number;
  source: "garmin" | "strava" | "both";
  isBrick?: boolean;
}

interface DayPMC {
  date: string;
  label: string;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number;
}

interface WeekPoint {
  week: string;
  swim: number;
  bike: number;
  run: number;
  total: number;
  swimH: number;
  bikeH: number;
  runH: number;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function greet(name?: string | null): string {
  const h = new Date().getHours();
  const t = h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night";
  return `Good ${t}${name ? `, ${name.split(" ")[0]}` : ""}`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  if (n === 0) return new Date("2000-01-01");
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function monOf(d: Date): Date {
  const day = d.getDay();
  const m = new Date(d);
  m.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  m.setHours(0, 0, 0, 0);
  return m;
}

function relativeTime(date: Date): string {
  const h = (Date.now() - date.getTime()) / 3_600_000;
  if (h < 1 / 60) return "Just now";
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  if (h < 48) return "Yesterday";
  return `${Math.round(h / 24)}d ago`;
}

function weekStart(offset = 0): Date {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day) - offset * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

function normalizeSport(raw: string | null | undefined): SportType {
  const t = (raw ?? "").toLowerCase();
  if (/swim|open.?water/.test(t)) return "swim";
  if (/ride|cycling|bike|virtual/.test(t)) return "bike";
  if (/run|trail/.test(t)) return "run";
  return "other";
}

function getHRZone(hr: number, maxHR: number): 1 | 2 | 3 | 4 | 5 {
  const p = hr / maxHR;
  if (p < 0.60) return 1;
  if (p < 0.70) return 2;
  if (p < 0.80) return 3;
  if (p < 0.90) return 4;
  return 5;
}

function garminTSS(g: GarminActivityRow): number {
  if (g.training_load != null) return Math.min(g.training_load, 400);
  const h = (g.duration_seconds ?? 0) / 3600;
  if (!h) return 0;
  const intensity = g.avg_heart_rate ? g.avg_heart_rate / DEFAULT_MAX_HR : 0.7;
  const ae = g.aerobic_effect ? g.aerobic_effect / 3 : 1;
  return Math.min(h * intensity * ae * 80, 400);
}

function stravaTSS(s: StravaActivityRow): number {
  if (s.suffer_score != null) return Math.min(s.suffer_score * 2, 400);
  const h = (s.elapsed_time ?? 0) / 3600;
  if (!h) return 0;
  const hr = s.avg_heartrate ?? DEFAULT_MAX_HR * 0.75;
  return Math.min(h * (hr / DEFAULT_MAX_HR) * 80, 400);
}

function mergeActivities(
  garmin: GarminActivityRow[],
  strava: StravaActivityRow[],
): MergedActivity[] {
  const used = new Set<string>();
  const out: MergedActivity[] = [];

  for (const g of garmin) {
    if (!g.start_time) continue;
    const gDT = new Date(g.start_time);
    const gSp = normalizeSport(g.activity_type);
    const match = strava.find((s) => {
      if (used.has(s.id)) return false;
      return (
        Math.abs(gDT.getTime() - new Date(s.start_date).getTime()) / 60000 <= 5 &&
        normalizeSport(s.sport_type) === gSp
      );
    });
    if (match) {
      used.add(match.id);
      out.push({
        id: `both-${g.id}`,
        date: g.start_time.slice(0, 10),
        dateTime: gDT,
        sport: gSp,
        name: match.name || g.activity_name || "Activity",
        durationSec: match.moving_time || g.duration_seconds || 0,
        distanceM: match.distance || g.distance_meters || 0,
        avgHR: match.avg_heartrate ?? g.avg_heart_rate,
        maxHR: match.max_heartrate ?? g.max_heart_rate,
        tss: stravaTSS(match) || garminTSS(g),
        source: "both",
      });
    } else {
      out.push({
        id: `g-${g.id}`,
        date: g.start_time.slice(0, 10),
        dateTime: gDT,
        sport: gSp,
        name: g.activity_name || "Activity",
        durationSec: g.duration_seconds || 0,
        distanceM: g.distance_meters || 0,
        avgHR: g.avg_heart_rate,
        maxHR: g.max_heart_rate,
        tss: garminTSS(g),
        source: "garmin",
      });
    }
  }

  for (const s of strava) {
    if (used.has(s.id)) continue;
    out.push({
      id: `s-${s.id}`,
      date: s.start_date.slice(0, 10),
      dateTime: new Date(s.start_date),
      sport: normalizeSport(s.sport_type),
      name: s.name || "Activity",
      durationSec: s.moving_time || s.elapsed_time || 0,
      distanceM: s.distance || 0,
      avgHR: s.avg_heartrate,
      maxHR: s.max_heartrate,
      tss: stravaTSS(s),
      source: "strava",
    });
  }

  // Sort ascending, mark bricks, then reverse
  out.sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime());
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i], b = out[i + 1];
    if (
      a.sport === "bike" && b.sport === "run" &&
      (b.dateTime.getTime() - a.dateTime.getTime()) / 3_600_000 <= 2
    ) b.isBrick = true;
  }
  return out.reverse();
}

function computeWeeklyTSS(activities: MergedActivity[]): WeekPoint[] {
  type W = { swim: number; bike: number; run: number; swimS: number; bikeS: number; runS: number };
  const map = new Map<string, W>();
  for (const a of activities) {
    const key = isoDate(monOf(a.dateTime));
    if (!map.has(key)) map.set(key, { swim: 0, bike: 0, run: 0, swimS: 0, bikeS: 0, runS: 0 });
    const w = map.get(key)!;
    if (a.sport === "swim") { w.swim += a.tss; w.swimS += a.durationSec; }
    else if (a.sport === "bike") { w.bike += a.tss; w.bikeS += a.durationSec; }
    else if (a.sport === "run")  { w.run  += a.tss; w.runS  += a.durationSec; }
  }
  const result: WeekPoint[] = [];
  const today = new Date();
  for (let i = 7; i >= 0; i--) {
    const ref = new Date(today);
    ref.setDate(today.getDate() - i * 7);
    const mon = monOf(ref);
    const key = isoDate(mon);
    const w = map.get(key) ?? { swim: 0, bike: 0, run: 0, swimS: 0, bikeS: 0, runS: 0 };
    result.push({
      week: `${mon.getMonth() + 1}/${mon.getDate()}`,
      swim:  Math.round(w.swim),
      bike:  Math.round(w.bike),
      run:   Math.round(w.run),
      total: Math.round(w.swim + w.bike + w.run),
      swimH: +(w.swimS / 3600).toFixed(1),
      bikeH: +(w.bikeS / 3600).toFixed(1),
      runH:  +(w.runS  / 3600).toFixed(1),
    });
  }
  return result;
}

function computePMC(activities: MergedActivity[], days: number): DayPMC[] {
  const tssMap = new Map<string, number>();
  for (const a of activities) tssMap.set(a.date, (tssMap.get(a.date) ?? 0) + a.tss);

  let ctl = 0, atl = 0;
  const result: DayPMC[] = [];
  const warmup = 42;

  for (let i = days + warmup - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = isoDate(d);
    const tss = tssMap.get(key) ?? 0;
    const tsb = ctl - atl;
    ctl = ctl + (tss - ctl) / 42;
    atl = atl + (tss - atl) / 7;
    if (i < days) {
      result.push({
        date: key,
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        tss,
        ctl: +ctl.toFixed(1),
        atl: +atl.toFixed(1),
        tsb: +tsb.toFixed(1),
      });
    }
  }
  return result;
}

function computeReadiness(metrics: DailyMetricRow[], pmcData: DayPMC[]): number {
  const today = new Date();
  const last7 = metrics.filter(
    (m) => (today.getTime() - new Date(m.date).getTime()) / 86400000 < 7
  );
  const prev7 = metrics.filter((m) => {
    const d = (today.getTime() - new Date(m.date).getTime()) / 86400000;
    return d >= 7 && d < 14;
  });
  const avgHRV = (arr: DailyMetricRow[]) =>
    arr.length ? arr.reduce((s, m) => s + (HRV_SCORE[m.hrv_status ?? ""] ?? 60), 0) / arr.length : 60;
  const h7 = avgHRV(last7), h14 = avgHRV(prev7);
  const hrvScore = Math.min((h7 / Math.max(h14, 1)) * 75, 100);
  const sleepArr = last7.map((m) => m.sleep_score).filter((s): s is number => s != null);
  const sleepScore = sleepArr.length ? sleepArr.reduce((a, b) => a + b, 0) / sleepArr.length : 50;
  const tsb = pmcData.length ? pmcData[pmcData.length - 1].tsb : 0;
  const tsbScore = tsb > 10 ? 100 : tsb > 0 ? 80 : tsb > -10 ? 65 : tsb > -30 ? 45 : 25;
  return Math.round(Math.min(Math.max(hrvScore * 0.3 + sleepScore * 0.3 + tsbScore * 0.4, 0), 100));
}

function readinessColor(n: number) {
  return n >= 70 ? CLR.fresh : n >= 50 ? CLR.warn : CLR.danger;
}

function tsbLabel(tsb: number): string {
  if (tsb > 10)  return "Tapered / fresh";
  if (tsb > -10) return "Optimal training zone";
  if (tsb > -30) return "Building fitness";
  return "Overreaching risk";
}

function tsbColor(tsb: number): string {
  if (tsb > 10)  return CLR.fresh;
  if (tsb > -10) return "#60a5fa";
  if (tsb > -30) return CLR.warn;
  return CLR.danger;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skel({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-zinc-800 ${className}`} />;
}

// ─── Insight Bar ──────────────────────────────────────────────────────────────

function InsightBar({
  text,
  color = "zinc",
}: {
  text: string;
  color?: "green" | "amber" | "red" | "zinc" | "blue";
}) {
  const palette: Record<string, string> = {
    green: "border-emerald-700/40 bg-emerald-900/20 text-emerald-300",
    amber: "border-amber-700/40 bg-amber-900/20 text-amber-300",
    red:   "border-red-700/40 bg-red-900/20 text-red-300",
    zinc:  "border-zinc-700/40 bg-zinc-800/40 text-zinc-400",
    blue:  "border-blue-700/40 bg-blue-900/20 text-blue-300",
  };
  return (
    <p className={`rounded-lg border px-3 py-2 text-xs leading-snug ${palette[color]}`}>
      {text}
    </p>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function SyncToast({
  message,
  totalSynced,
  onDismiss,
}: {
  message: string;
  totalSynced: number;
  onDismiss: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  function goToCoach() {
    const prompt = "I just synced my activities. How was my week?";
    router.push(`/coach?prompt=${encodeURIComponent(prompt)}`);
    onDismiss();
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border border-green-700 bg-green-900 px-4 py-3 text-sm text-green-100 shadow-lg">
      <div className="flex items-center justify-between gap-3">
        <span>{message}</span>
        <button
          type="button"
          onClick={onDismiss}
          className="flex-shrink-0 text-green-400 hover:text-white"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      {totalSynced > 0 && (
        <button
          type="button"
          onClick={goToCoach}
          className="mt-2 text-xs text-green-300 underline underline-offset-2 hover:text-white"
        >
          Ask your coach about this week →
        </button>
      )}
    </div>
  );
}

// ─── Onboarding Banners ───────────────────────────────────────────────────────

function OnboardingBanners() {
  const [showGarmin, setShowGarmin] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const hasGarminData = useAppStore((s) => s.hasGarminData);

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

  return (
    <div className="space-y-2">
      {showGarmin && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-blue-700/50 bg-blue-900/20 px-4 py-3 text-sm">
          <span className="text-blue-200">
            Connect Garmin Connect to sync your training data —{" "}
            <Link href="/settings" className="font-semibold underline underline-offset-2 hover:text-white">
              Go to Settings
            </Link>
          </span>
          <button
            type="button"
            onClick={dismissGarmin}
            className="flex-shrink-0 text-blue-400 hover:text-white"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
      {showAI && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-emerald-700/50 bg-emerald-900/20 px-4 py-3 text-sm">
          <span className="text-emerald-200">
            Add an AI provider to chat with your coach —{" "}
            <Link href="/settings" className="font-semibold underline underline-offset-2 hover:text-white">
              Go to Settings
            </Link>
          </span>
          <button
            type="button"
            onClick={dismissAI}
            className="flex-shrink-0 text-emerald-400 hover:text-white"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({
  onSyncGarmin,
  onConnectStrava,
  syncing,
}: {
  onSyncGarmin: () => void;
  onConnectStrava: () => void;
  syncing: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/30 px-8 py-16 text-center">
      <div className="mb-6 flex items-center gap-3 text-zinc-600">
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden>
          <circle cx="18" cy="5" r="3" stroke="currentColor" strokeWidth="1.5" />
          <line x1="18" y1="8" x2="18" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="11" y1="13" x2="25" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="18" y1="18" x2="13" y2="28" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="18" y1="18" x2="23" y2="28" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="text-xs uppercase tracking-widest">swim · bike · run</span>
      </div>
      <h2 className="text-xl font-semibold text-zinc-100">No training data yet</h2>
      <p className="mt-2 max-w-sm text-sm text-zinc-400">
        Connect Garmin or Strava and sync your activities to see your performance dashboard.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={onSyncGarmin}
          disabled={syncing}
          className="rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {syncing ? "↻ Syncing…" : "Sync Garmin"}
        </button>
        <button
          type="button"
          onClick={onConnectStrava}
          className="rounded-xl border border-orange-600 bg-orange-900/20 px-6 py-3 text-sm font-semibold text-orange-300 transition hover:bg-orange-900/40"
        >
          Connect Strava
        </button>
      </div>
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({
  label,
  value,
  sub,
  trend,
  loading,
  valueColor,
  prevValue,
  changePct,
  accentColor,
}: {
  label: string;
  value: string | number;
  sub?: string;
  trend?: number | null;
  loading?: boolean;
  valueColor?: string;
  prevValue?: string | number;
  changePct?: number | null;
  accentColor?: string;
}) {
  if (loading) return <Skel className="h-28" />;
  const showCompare = prevValue !== undefined;
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 flex flex-col gap-1 overflow-hidden relative">
      {accentColor && (
        <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-xl" style={{ background: accentColor }} />
      )}
      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">{label}</p>
      <p
        className="font-condensed text-5xl font-bold leading-none tracking-tight"
        style={{ color: valueColor ?? "#f4f4f5" }}
      >
        {value}
        {showCompare && changePct != null && (
          <span className={`ml-2 text-base font-semibold ${changePct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {changePct >= 0 ? "↑" : "↓"}{Math.abs(changePct).toFixed(0)}%
          </span>
        )}
      </p>
      {showCompare ? (
        <p className="text-xs text-zinc-500 leading-snug">
          vs <span className="text-zinc-400 font-medium">{prevValue}</span> last week
          {changePct != null && (
            <span className={`ml-1 font-semibold ${changePct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              ({changePct >= 0 ? "+" : ""}{changePct.toFixed(0)}%)
            </span>
          )}
        </p>
      ) : (
        <>
          {sub && <p className="text-xs text-zinc-400 leading-snug">{sub}</p>}
          {trend != null && (
            <p className={`text-xs font-semibold ${trend >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(0)}% vs prev period
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ─── Weekly TSS Chart ─────────────────────────────────────────────────────────

function weekTSSInsight(data: WeekPoint[]): { text: string; color: "green" | "amber" | "zinc" } {
  const thisWeek = data[data.length - 1]?.total ?? 0;
  const lastWeek = data[data.length - 2]?.total ?? 0;
  if (lastWeek === 0 || thisWeek === 0) return { text: `This week: ${thisWeek} TSS`, color: "zinc" };
  const pct = Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
  const sign = pct >= 0 ? "+" : "";
  if (pct >= 5 && pct <= 20) {
    return { text: `This week: ${thisWeek} TSS — ${sign}${pct}% vs last week. Progressive overload ✓`, color: "green" };
  }
  if (pct > 20) {
    return { text: `This week: ${thisWeek} TSS — ${sign}${pct}% vs last week. Big jump — monitor recovery`, color: "amber" };
  }
  if (pct <= -20) {
    return { text: `This week: ${thisWeek} TSS — ${sign}${pct}% vs last week. Recovery week`, color: "amber" };
  }
  return { text: `This week: ${thisWeek} TSS — ${sign}${pct}% vs last week`, color: "zinc" };
}

function WeeklyTSSChart({ data, easyPct }: { data: WeekPoint[]; easyPct: number }) {
  const hardPct  = 100 - easyPct;
  const barColor = easyPct >= 75 ? CLR.fresh : easyPct >= 60 ? CLR.warn : CLR.danger;
  const tssInsight = weekTSSInsight(data);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200">Weekly TSS by Sport</h2>
        <span className="text-xs text-zinc-500">last 8 weeks</span>
      </div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barSize={18}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis dataKey="week" stroke="#52525b" fontSize={10} />
            <YAxis stroke="#52525b" fontSize={10} />
            <Tooltip
              contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
              formatter={(v: unknown, name: unknown) => [
                `${v as number} TSS`,
                String(name).charAt(0).toUpperCase() + String(name).slice(1),
              ]}
            />
            <Bar dataKey="swim" stackId="a" fill={SPORT.swim.bg} />
            <Bar dataKey="bike" stackId="a" fill={SPORT.bike.bg} />
            <Bar dataKey="run"  stackId="a" fill={SPORT.run.bg}  radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 80/20 polarization indicator */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-500">Polarization (easy vs hard)</span>
          <span style={{ color: barColor }} className="font-semibold">
            {easyPct.toFixed(0)}% easy · {hardPct.toFixed(0)}% hard
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${easyPct}%`, background: barColor }} />
        </div>
        <p className="text-xs text-zinc-500">
          {easyPct >= 75
            ? "✓ Great aerobic base work"
            : easyPct >= 60
            ? "⚠ Aim for 80% easy training"
            : "⚠ Too much gray zone — polarize more"}
        </p>
      </div>
      <InsightBar text={tssInsight.text} color={tssInsight.color} />
    </div>
  );
}

// ─── Volume Split Panel ───────────────────────────────────────────────────────

function VolumeSplitPanel({ activities }: { activities: MergedActivity[] }) {
  const totalSec = activities.reduce((s, a) => s + a.durationSec, 0);
  const sports = ["swim", "bike", "run"] as const;

  const rows = sports.map((sp) => {
    const acts = activities.filter((a) => a.sport === sp);
    const sec  = acts.reduce((s, a) => s + a.durationSec, 0);
    const tss  = acts.reduce((s, a) => s + a.tss, 0);
    return { sp, sec, tss, pct: totalSec > 0 ? (sec / totalSec) * 100 : 0, hrs: sec / 3600 };
  });

  const totalTSS = rows.reduce((s, r) => s + r.tss, 0);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 space-y-5">
      <h2 className="text-sm font-semibold text-zinc-200">Volume Split</h2>

      <div className="flex justify-around">
        {rows.map(({ sp, pct, hrs }) => (
          <div key={sp} className="flex flex-col items-center gap-1">
            <div
              className="h-16 w-16 rounded-full flex items-center justify-center font-bold text-white text-sm shadow-lg"
              style={{ background: SPORT[sp].bg }}
            >
              {pct.toFixed(0)}%
            </div>
            <span className="text-xs text-zinc-400 capitalize">{sp}</span>
            <span className="text-sm font-bold text-zinc-200">{hrs.toFixed(1)}h</span>
          </div>
        ))}
      </div>

      <div className="space-y-2.5">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">TSS Distribution</p>
        {rows.map(({ sp, tss }) => {
          const pct = totalTSS > 0 ? (tss / totalTSS) * 100 : 0;
          return (
            <div key={sp} className="space-y-1">
              <div className="flex justify-between text-xs text-zinc-400">
                <span className="capitalize">{sp}</span>
                <span>{Math.round(tss)} TSS</span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: SPORT[sp].bg }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── HR Zones Chart ───────────────────────────────────────────────────────────

function HRZonesChart({
  activities,
  sportFilter,
}: {
  activities: MergedActivity[];
  sportFilter: SportFilter;
}) {
  const zoneData = useMemo(() => {
    const zones = [0, 0, 0, 0, 0];
    for (const a of activities) {
      if (sportFilter !== "all" && a.sport !== sportFilter) continue;
      if (!a.avgHR) continue;
      const maxHR = a.maxHR ?? DEFAULT_MAX_HR;
      const z = getHRZone(a.avgHR, maxHR) - 1;
      const min = a.durationSec / 60;
      zones[z] += min * 0.8;
      if (z > 0) zones[z - 1] += min * 0.1;
      if (z < 4) zones[z + 1] += min * 0.1;
    }
    const total = zones.reduce((a, b) => a + b, 0);
    return zones.map((min, i) => ({
      zone: `Z${i + 1}`,
      minutes: Math.round(min),
      pct: total > 0 ? Math.round((min / total) * 100) : 0,
    }));
  }, [activities, sportFilter]);

  const z2pct    = zoneData[1]?.pct ?? 0;
  const hardPct  = (zoneData[3]?.pct ?? 0) + (zoneData[4]?.pct ?? 0);
  const z3pct    = zoneData[2]?.pct ?? 0;
  const aeroPct  = (zoneData[0]?.pct ?? 0) + z2pct;
  const { insight, insightColor }: { insight: string; insightColor: "green" | "amber" | "zinc" } =
    aeroPct > 75
      ? { insight: `Great polarized training — ${aeroPct}% in aerobic base (Z1+Z2)`, insightColor: "green" }
      : z3pct > 25
      ? { insight: `Gray zone alert — ${z3pct}% in Z3. Consider going easier or harder.`, insightColor: "amber" }
      : hardPct > 25
      ? { insight: `High intensity week — ${hardPct}% in Z4+Z5. Monitor recovery closely.`, insightColor: "amber" }
      : { insight: "Training distribution looks balanced", insightColor: "zinc" };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200">Heart Rate Zones</h2>
        <span className="text-xs text-zinc-500">estimated from avg HR</span>
      </div>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={zoneData} barSize={34}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis dataKey="zone" stroke="#52525b" fontSize={11} />
            <YAxis stroke="#52525b" fontSize={10} unit="m" />
            <Tooltip
              contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
              formatter={(v: unknown) => [`${v as number} min`, "Time"]}
            />
            <Bar dataKey="minutes" radius={[4, 4, 0, 0]}>
              {zoneData.map((_, i) => (
                <Cell key={i} fill={ZONE_COLORS[i]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <InsightBar text={insight} color={insightColor} />
    </div>
  );
}

// ─── Readiness Gauge ──────────────────────────────────────────────────────────

function ReadinessGauge({ value }: { value: number }) {
  const color = readinessColor(value);
  const data = [{ value, fill: color }];
  return (
    <div className="relative flex items-center justify-center" style={{ width: 160, height: 90 }}>
      <RadialBarChart
        width={160}
        height={160}
        cx={80}
        cy={90}
        innerRadius={55}
        outerRadius={78}
        barSize={14}
        data={data}
        startAngle={180}
        endAngle={0}
      >
        <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
        <RadialBar
          dataKey="value"
          cornerRadius={7}
          background={{ fill: "#27272a" }}
        />
      </RadialBarChart>
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
        <span className="font-condensed text-4xl font-bold leading-none" style={{ color }}>
          {value}
        </span>
        <span className="text-[10px] text-zinc-500 uppercase tracking-widest">/ 100</span>
      </div>
    </div>
  );
}

// ─── Recovery Panel ───────────────────────────────────────────────────────────

function RecoveryPanel({
  metrics,
  activities,
  readiness,
}: {
  metrics: DailyMetricRow[];
  activities: MergedActivity[];
  readiness: number;
}) {
  const sparkData = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (13 - i));
      const key = isoDate(d);
      const m = metrics.find((r) => r.date === key);
      return {
        day: `${d.getMonth() + 1}/${d.getDate()}`,
        score: m?.hrv_status ? (HRV_SCORE[m.hrv_status] ?? null) : null,
        label: m?.hrv_status ?? "—",
      };
    });
  }, [metrics]);

  const baseline = useMemo(() => {
    const vals = sparkData.map((d) => d.score).filter((s): s is number => s != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 60;
  }, [sparkData]);

  const recent = activities.slice(0, 5);
  const rColor = readinessColor(readiness);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 space-y-4">
      <h2 className="text-sm font-semibold text-zinc-200">Recovery & Readiness</h2>

      <div className="flex flex-col items-center gap-1">
        <ReadinessGauge value={readiness} />
        <p className="text-sm font-semibold text-zinc-300 -mt-1">Race Readiness</p>
        <p className="text-xs font-medium" style={{ color: rColor }}>
          {readiness >= 70 ? "Ready to race" : readiness >= 50 ? "Building form" : "Rest needed"}
        </p>
      </div>

      <div>
        <p className="mb-1.5 text-xs text-zinc-500">HRV Status — last 14 days</p>
        <div className="h-16">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sparkData} barSize={12}>
              <XAxis dataKey="day" stroke="#52525b" fontSize={8} />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 11 }}
                formatter={(_: unknown, __: unknown, item: { payload?: { label?: string } }) => [
                  item.payload?.label ?? "—",
                  "HRV",
                ]}
              />
              <Bar dataKey="score">
                {sparkData.map((d, i) => (
                  <Cell
                    key={i}
                    fill={
                      d.score == null
                        ? "#3f3f46"
                        : d.score >= baseline
                        ? CLR.fresh
                        : d.score >= baseline * 0.85
                        ? "#60a5fa"
                        : CLR.danger
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-zinc-500">Recent sessions</p>
        {recent.map((a) => (
          <div key={a.id} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="h-2 w-2 rounded-full flex-shrink-0"
                style={{ background: getSportColor(a.sport).dot }}
              />
              <span className="text-zinc-300 truncate">{a.name}</span>
              {a.isBrick && (
                <span
                  className="rounded px-1 py-0.5 text-[9px] font-bold text-white flex-shrink-0"
                  style={{ background: CLR.brick }}
                >
                  BRICK
                </span>
              )}
            </div>
            <span className="text-zinc-500 flex-shrink-0 ml-2">{Math.round(a.tss)} TSS</span>
          </div>
        ))}
        {recent.length === 0 && <p className="text-xs text-zinc-600">No recent sessions</p>}
      </div>
    </div>
  );
}

// ─── PMC Chart ────────────────────────────────────────────────────────────────

function PMCChart({ data }: { data: DayPMC[] }) {
  const latest = data[data.length - 1];

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-200">Fitness · Fatigue · Form</h2>
          <p className="text-xs text-zinc-500">CTL / ATL / TSB performance model — 42 days</p>
        </div>
        {latest && (
          <div className="flex gap-4 text-xs font-mono">
            <span>
              <span className="text-blue-400 font-bold">CTL </span>
              <span className="text-zinc-300">{latest.ctl.toFixed(0)}</span>
            </span>
            <span>
              <span className="text-orange-400 font-bold">ATL </span>
              <span className="text-zinc-300">{latest.atl.toFixed(0)}</span>
            </span>
            <span style={{ color: tsbColor(latest.tsb) }}>
              <span className="font-bold">TSB </span>
              {latest.tsb > 0 ? "+" : ""}{latest.tsb.toFixed(0)}{" "}
              <span className="opacity-70 text-[10px]">({tsbLabel(latest.tsb)})</span>
            </span>
          </div>
        )}
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="label" stroke="#52525b" fontSize={10} interval={6} />
            <YAxis stroke="#52525b" fontSize={10} />
            <ReferenceLine y={0}   stroke="#52525b" strokeDasharray="4 4" />
            <ReferenceLine y={-30} stroke={CLR.danger} strokeDasharray="2 4" strokeOpacity={0.4} />
            <ReferenceArea y1={0}   y2={15}  fill={CLR.fresh}  fillOpacity={0.05} />
            <ReferenceArea y1={-60} y2={-30} fill={CLR.danger} fillOpacity={0.07} />
            <Tooltip
              contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
              formatter={(v: unknown, name: unknown) => {
                const n = String(name);
                const num = v as number;
                if (n === "ctl") return [`${num.toFixed(1)}`, "CTL (Fitness)"] as [string, string];
                if (n === "atl") return [`${num.toFixed(1)}`, "ATL (Fatigue)"] as [string, string];
                if (n === "tsb") return [`${num > 0 ? "+" : ""}${num.toFixed(1)} · ${tsbLabel(num)}`, "TSB (Form)"] as [string, string];
                return [`${num}`, n] as [string, string];
              }}
            />
            <Line type="monotone" dataKey="ctl" stroke="#60a5fa" strokeWidth={2} dot={false} name="ctl" />
            <Line type="monotone" dataKey="atl" stroke="#fb923c" strokeWidth={2} dot={false} name="atl" />
            <Line
              type="monotone" dataKey="tsb" stroke={CLR.fresh}
              strokeWidth={2} strokeDasharray="5 3" dot={false} name="tsb"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {latest && (() => {
        const tsb = latest.tsb;
        const { text, color }: { text: string; color: "green" | "blue" | "zinc" | "amber" | "red" } =
          tsb > 10   ? { text: `Form: Tapered — TSB ${tsb > 0 ? "+" : ""}${tsb.toFixed(0)}. Good for racing or testing.`, color: "green" }
          : tsb > 0  ? { text: `Form: Fresh — TSB +${tsb.toFixed(0)}. Optimal for quality sessions.`, color: "green" }
          : tsb > -10 ? { text: `Form: Neutral — TSB ${tsb.toFixed(0)}. Steady training.`, color: "blue" }
          : tsb > -30 ? { text: `Form: Building — TSB ${tsb.toFixed(0)}. Normal fatigue, trust the process.`, color: "zinc" }
          : { text: `Form: Overreaching risk — TSB ${tsb.toFixed(0)}. Consider a recovery day.`, color: "amber" };
        return <InsightBar text={text} color={color} />;
      })()}
    </div>
  );
}

// ─── AI Insight Banner ────────────────────────────────────────────────────────

function AIInsightBanner() {
  const router = useRouter();
  const [analysis, setAnalysis] = useState<CoachAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getCoachAnalysis()
      .then(setAnalysis)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : "Analysis unavailable"))
      .finally(() => setLoading(false));
  }, []);

  function goToCoach() {
    try {
      sessionStorage.setItem(
        "coach_prefill",
        "Based on my current training load and recovery, what should I focus on this week?",
      );
    } catch { /* noop */ }
    router.push("/coach");
  }

  const STATUS_COLORS: Record<string, string> = {
    balanced: "#60a5fa", ready: CLR.fresh,
    building: CLR.warn, recovering: "#a78bfa",
    "high fatigue": CLR.danger, overreaching: CLR.danger,
  };
  const statusKey  = (analysis?.overall_status ?? "").toLowerCase();
  const statusColor = STATUS_COLORS[statusKey] ?? "#94a3b8";

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5 space-y-2">
        <Skel className="h-4 w-48" />
        <Skel className="h-3 w-full" />
        <Skel className="h-3 w-5/6" />
        <Skel className="h-3 w-4/6" />
      </div>
    );
  }

  if (err || !analysis) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5 text-sm text-zinc-500">
        {err ?? "AI analysis unavailable — configure your AI provider in Settings."}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-200">AI Training Insight</span>
          {analysis.overall_status && (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-bold capitalize"
              style={{ background: `${statusColor}22`, color: statusColor }}
            >
              {analysis.overall_status}
            </span>
          )}
        </div>
        <button
          onClick={goToCoach}
          className="rounded-lg border border-emerald-700 bg-emerald-900/30 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-900/60 transition"
        >
          Ask your coach →
        </button>
      </div>

      {(analysis.key_observations?.length ?? 0) > 0 && (
        <div>
          <p className="text-xs text-zinc-500 mb-1.5">Observations</p>
          <ul className="space-y-1">
            {(analysis.key_observations ?? []).slice(0, 3).map((obs, i) => (
              <li key={i} className="flex gap-2 text-xs text-zinc-300">
                <span className="text-zinc-600 flex-shrink-0 mt-0.5">•</span>
                {obs}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(analysis.recommendations?.length ?? 0) > 0 && (
        <div>
          <p className="text-xs text-zinc-500 mb-1.5">Recommendations</p>
          <ul className="space-y-1">
            {(analysis.recommendations ?? []).slice(0, 2).map((rec, i) => (
              <li key={i} className="flex gap-2 text-xs text-zinc-300">
                <span className="text-emerald-600 flex-shrink-0 mt-0.5">→</span>
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: session } = useSession();
  const { userId } = useAppStore();

  const [sportFilter, setSportFilter] = useState<SportFilter>("all");
  const [dateRange, setDateRange]     = useState<DateRange>(30);
  const [syncing, setSyncing]         = useState(false);
  const [toast, setToast]             = useState<string | null>(null);
  const [totalSynced, setTotalSynced] = useState(0);
  const [compareMode, setCompareMode] = useState<"current" | "compare">("current");

  const [garminActs,    setGarminActs]    = useState<GarminActivityRow[]>([]);
  const [stravaActs,    setStravaActs]    = useState<StravaActivityRow[]>([]);
  const [dailyMetrics,  setDailyMetrics]  = useState<DailyMetricRow[]>([]);
  const [loading, setLoading]            = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    const apiDays = dateRange === 0 ? 0 : dateRange + 42;
    const apiLimit = dateRange === 0 ? 2000 : Math.min(dateRange * 3 + 100, 2000);
    try {
      const [g, s, m] = await Promise.all([
        getGarminActivities({ limit: apiLimit, days: apiDays }).catch(() => [] as GarminActivityRow[]),
        getStravaActivities({ limit: apiLimit, days: apiDays }).catch(() => [] as StravaActivityRow[]),
        getGarminDailyMetrics({ days: 42 }).catch(() => [] as DailyMetricRow[]),
      ]);
      setGarminActs(g);
      setStravaActs(s);
      setDailyMetrics(m);
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    if (!userId) return;
    void loadData();
  }, [loadData, userId]);

  // ── Derived data ──

  const merged = useMemo(() => mergeActivities(garminActs, stravaActs), [garminActs, stravaActs]);

  const cutoff = useMemo(() => daysAgo(dateRange), [dateRange]);

  const filtered = useMemo(
    () => merged.filter((a) => a.dateTime >= cutoff),
    [merged, cutoff],
  );

  const sportFiltered = useMemo(
    () => (sportFilter === "all" ? filtered : filtered.filter((a) => a.sport === sportFilter)),
    [filtered, sportFilter],
  );

  const pmcData    = useMemo(() => computePMC(merged, 42), [merged]);
  const weeklyTSS  = useMemo(() => computeWeeklyTSS(sportFiltered), [sportFiltered]);
  const readiness  = useMemo(() => computeReadiness(dailyMetrics, pmcData), [dailyMetrics, pmcData]);

  // Easy/hard ratio from HR zones
  const easyPct = useMemo(() => {
    const zones = [0, 0, 0, 0, 0];
    for (const a of sportFiltered) {
      if (!a.avgHR) continue;
      const z = getHRZone(a.avgHR, a.maxHR ?? DEFAULT_MAX_HR) - 1;
      const min = a.durationSec / 60;
      zones[z] += min * 0.8;
      if (z > 0) zones[z - 1] += min * 0.1;
      if (z < 4) zones[z + 1] += min * 0.1;
    }
    const total = zones.reduce((a, b) => a + b, 0);
    return total > 0 ? ((zones[0] + zones[1]) / total) * 100 : 0;
  }, [sportFiltered]);

  // KPIs
  const kpis = useMemo(() => {
    const prevCutoff = daysAgo(dateRange * 2);
    const prev = merged.filter(
      (a) => a.dateTime >= prevCutoff && a.dateTime < cutoff &&
             (sportFilter === "all" || a.sport === sportFilter),
    );
    const totalTSS = sportFiltered.reduce((s, a) => s + a.tss, 0);
    const prevTSS  = prev.reduce((s, a) => s + a.tss, 0);
    const tssTrend = prevTSS > 0 ? Math.round(((totalTSS - prevTSS) / prevTSS) * 100) : null;

    const swimH = sportFiltered.filter((a) => a.sport === "swim").reduce((s, a) => s + a.durationSec, 0) / 3600;
    const bikeH = sportFiltered.filter((a) => a.sport === "bike").reduce((s, a) => s + a.durationSec, 0) / 3600;
    const runH  = sportFiltered.filter((a) => a.sport === "run" ).reduce((s, a) => s + a.durationSec, 0) / 3600;
    const totalH = swimH + bikeH + runH;

    const today = new Date();
    const last7 = dailyMetrics.filter(
      (m) => (today.getTime() - new Date(m.date).getTime()) / 86400000 < 7
    );
    const prev7 = dailyMetrics.filter((m) => {
      const d = (today.getTime() - new Date(m.date).getTime()) / 86400000;
      return d >= 7 && d < 14;
    });
    const avgHRV = (arr: DailyMetricRow[]) =>
      arr.length ? arr.reduce((s, m) => s + (HRV_SCORE[m.hrv_status ?? ""] ?? 60), 0) / arr.length : null;
    const h7 = avgHRV(last7), h14 = avgHRV(prev7);
    const hrvTrend = h7 != null && h14 != null && h14 > 0
      ? Math.round(((h7 - h14) / h14) * 100)
      : null;

    return {
      totalTSS: Math.round(totalTSS),
      tssTrend,
      totalH,
      swimH, bikeH, runH,
      hrv7: h7 != null ? Math.round(h7) : null,
      hrv14: h14 != null ? Math.round(h14) : null,
      hrvTrend,
    };
  }, [merged, sportFiltered, sportFilter, cutoff, dateRange, dailyMetrics]);

  // ── Last sync date ──
  const lastSyncDate = useMemo(() => {
    const dates: Date[] = [];
    for (const a of garminActs) {
      if (a.synced_at) dates.push(new Date(a.synced_at));
    }
    for (const a of stravaActs) {
      if (a.synced_at) dates.push(new Date(a.synced_at));
    }
    return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
  }, [garminActs, stravaActs]);

  const syncStatus = useMemo(() => {
    if (!lastSyncDate) return { text: "No data synced yet", dot: "gray" as const };
    const h = (Date.now() - lastSyncDate.getTime()) / 3_600_000;
    if (h > 24 * 7) return { text: `Data outdated — sync now (${relativeTime(lastSyncDate)})`, dot: "red" as const };
    if (h > 24)     return { text: `Sync recommended (${relativeTime(lastSyncDate)})`, dot: "amber" as const };
    return { text: `Last sync: ${relativeTime(lastSyncDate)}`, dot: "green" as const };
  }, [lastSyncDate]);

  // ── Week comparison KPIs ──
  const weeklyKpis = useMemo(() => {
    const thisStart = weekStart(0);
    const lastStart = weekStart(1);
    const thisActs  = merged.filter((a) => a.dateTime >= thisStart);
    const lastActs  = merged.filter((a) => a.dateTime >= lastStart && a.dateTime < thisStart);
    const tss  = (arr: MergedActivity[]) => Math.round(arr.reduce((s, a) => s + a.tss, 0));
    const hrs  = (arr: MergedActivity[]) => +(arr.reduce((s, a) => s + a.durationSec, 0) / 3600).toFixed(1);
    const thisTSS = tss(thisActs), lastTSS = tss(lastActs);
    const thisH = hrs(thisActs),   lastH   = hrs(lastActs);
    const pctChg = (cur: number, prev: number) =>
      prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
    return {
      thisTSS, lastTSS, tssChange: pctChg(thisTSS, lastTSS),
      thisH,   lastH,   hrsChange: pctChg(thisH,   lastH),
      thisSessions: thisActs.length, lastSessions: lastActs.length,
      sessionsChange: pctChg(thisActs.length, lastActs.length),
    };
  }, [merged]);

  // ── Sync ──
  async function handleSync() {
    setSyncing(true);
    setToast(null);
    try {
      const [gr, sr] = await Promise.allSettled([postGarminSync(), postStravaSync({ days_back: 60 })]);
      let totalActs = 0;
      if (gr.status === "fulfilled") totalActs += gr.value.synced_activities ?? 0;
      if (sr.status === "fulfilled") totalActs += sr.value.synced ?? 0;
      setTotalSynced(totalActs);
      setToast(`✓ Synced ${totalActs} activities`);
      await loadData();
    } catch {
      setToast("Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleConnectStrava() {
    try {
      const { auth_url } = await getStravaConnect();
      window.location.href = auth_url;
    } catch {
      setToast("Failed to get Strava OAuth URL");
    }
  }

  const noData = !loading && merged.length === 0;

  return (
    <div className="space-y-5 pb-12">

      {/* Onboarding banners */}
      <OnboardingBanners />

      {/* Toast */}
      {toast && <SyncToast message={toast} totalSynced={totalSynced} onDismiss={() => setToast(null)} />}

      {/* Top bar */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-zinc-100 tracking-tight">
            {greet(session?.user?.name)}
          </h1>
          <p className="text-sm text-zinc-500">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long", year: "numeric", month: "long", day: "numeric",
            })}
          </p>
          {/* Sync status */}
          {!loading && (
            <div className="mt-1 flex items-center gap-1.5">
              <span
                className="h-2 w-2 flex-shrink-0 rounded-full"
                style={{
                  background:
                    syncStatus.dot === "green" ? CLR.fresh
                    : syncStatus.dot === "amber" ? CLR.warn
                    : syncStatus.dot === "red"   ? CLR.danger
                    : "#52525b",
                }}
              />
              <span className={`text-xs ${
                syncStatus.dot === "green" ? "text-zinc-500"
                : syncStatus.dot === "amber" ? "text-amber-400"
                : syncStatus.dot === "red"   ? "text-red-400"
                : "text-zinc-500"
              }`}>
                {syncStatus.text}
              </span>
            </div>
          )}
        </div>
        <button
          onClick={() => void handleSync()}
          disabled={syncing}
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 transition"
        >
          {syncing ? "↻ Syncing…" : "↻ Sync"}
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-1 gap-1">
          {(["all", "swim", "bike", "run"] as const).map((sp) => (
            <button
              key={sp}
              onClick={() => setSportFilter(sp)}
              className={`rounded-md px-3 py-1.5 text-xs font-bold capitalize transition ${
                sportFilter === sp ? "text-white" : "text-zinc-500 hover:text-zinc-300"
              }`}
              style={
                sportFilter === sp
                  ? { background: sp === "all" ? "#3f3f46" : getSportColor(sp).dot }
                  : {}
              }
            >
              {sp === "all" ? "All" : sp}
            </button>
          ))}
        </div>

        <div className="flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-1 gap-1">
          {([
            { value: 7, label: "7d" },
            { value: 30, label: "30d" },
            { value: 90, label: "3m" },
            { value: 180, label: "6m" },
            { value: 365, label: "1y" },
            { value: 0, label: "All" },
          ] as { value: DateRange; label: string }[]).map(({ value, label }) => (
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
      </div>

      {/* Loading label */}
      {loading && (
        <p className="text-center text-sm text-zinc-500">Syncing your training data…</p>
      )}

      {/* Empty state */}
      {noData && (
        <EmptyState
          onSyncGarmin={() => void handleSync()}
          onConnectStrava={() => void handleConnectStrava()}
          syncing={syncing}
        />
      )}

      {/* KPI row */}
      <div className="space-y-2">
        {/* Compare toggle */}
        <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-1 w-fit">
          {(["current", "compare"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setCompareMode(m)}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                compareMode === m
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {m === "current" ? "This week" : "vs Last week"}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {compareMode === "compare" ? (
            <>
              <KPICard
                label="Training Load"
                value={`${weeklyKpis.thisTSS} TSS`}
                loading={loading}
                prevValue={`${weeklyKpis.lastTSS} TSS`}
                changePct={weeklyKpis.tssChange}
              />
              <KPICard
                label="Volume"
                value={`${weeklyKpis.thisH}h`}
                loading={loading}
                prevValue={`${weeklyKpis.lastH}h`}
                changePct={weeklyKpis.hrsChange}
              />
              <KPICard
                label="Sessions"
                value={weeklyKpis.thisSessions}
                loading={loading}
                prevValue={weeklyKpis.lastSessions}
                changePct={weeklyKpis.sessionsChange}
              />
              <KPICard
                label="Race Readiness"
                value={readiness}
                sub="/100"
                loading={loading}
                valueColor={readinessColor(readiness)}
              />
            </>
          ) : (
            <>
              <KPICard
                label="Training Load"
                value={kpis.totalTSS}
                sub={`TSS over ${dateRange}d`}
                trend={kpis.tssTrend}
                loading={loading}
              />
              <KPICard
                label="Volume"
                value={`${kpis.totalH.toFixed(1)}h`}
                sub={`${kpis.swimH.toFixed(1)} swim · ${kpis.bikeH.toFixed(1)} bike · ${kpis.runH.toFixed(1)} run`}
                loading={loading}
              />
              <KPICard
                label="HRV Trend"
                value={kpis.hrv7 ?? "—"}
                sub={kpis.hrv14 != null ? `prev 7d: ${kpis.hrv14}` : "7-day avg score"}
                trend={kpis.hrvTrend}
                loading={loading}
              />
              <KPICard
                label="Race Readiness"
                value={readiness}
                sub="/100 · HRV + sleep + form"
                loading={loading}
                valueColor={readinessColor(readiness)}
              />
            </>
          )}
        </div>
      </div>

      {/* Main charts row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <WeeklyTSSChart data={weeklyTSS} easyPct={easyPct} />
        </div>
        <VolumeSplitPanel activities={sportFiltered} />
      </div>

      {/* Second charts row */}
      <div className="grid gap-4 lg:grid-cols-2">
        <HRZonesChart activities={sportFiltered} sportFilter={sportFilter} />
        <RecoveryPanel metrics={dailyMetrics} activities={merged} readiness={readiness} />
      </div>

      {/* PMC */}
      <PMCChart data={pmcData} />

      {/* AI Insight */}
      <AIInsightBanner />
    </div>
  );
}
