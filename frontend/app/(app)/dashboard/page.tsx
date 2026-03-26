"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
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
  postGarminSync,
  postStravaSync,
  type CoachAnalysis,
  type DailyMetricRow,
  type GarminActivityRow,
  type StravaActivityRow,
} from "@/lib/api";
import { useAppStore } from "@/store/appStore";

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
type DateRange  = 7 | 30 | 90;
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

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({
  label,
  value,
  sub,
  trend,
  loading,
  valueColor,
}: {
  label: string;
  value: string | number;
  sub?: string;
  trend?: number | null;
  loading?: boolean;
  valueColor?: string;
}) {
  if (loading) return <Skel className="h-28" />;
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 flex flex-col gap-1">
      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">{label}</p>
      <p className="text-3xl font-black leading-none" style={{ color: valueColor ?? "#f4f4f5" }}>
        {value}
      </p>
      {sub && <p className="text-xs text-zinc-400 leading-snug">{sub}</p>}
      {trend != null && (
        <p className={`text-xs font-semibold ${trend >= 0 ? "text-emerald-400" : "text-red-400"}`}>
          {trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(0)}% vs prev period
        </p>
      )}
    </div>
  );
}

// ─── Weekly TSS Chart ─────────────────────────────────────────────────────────

function WeeklyTSSChart({ data, easyPct }: { data: WeekPoint[]; easyPct: number }) {
  const hardPct  = 100 - easyPct;
  const barColor = easyPct >= 75 ? CLR.fresh : easyPct >= 60 ? CLR.warn : CLR.danger;

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
              formatter={(v: unknown, name: string) => [
                `${v as number} TSS`,
                name.charAt(0).toUpperCase() + name.slice(1),
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

  const z2pct   = zoneData[1]?.pct ?? 0;
  const hardPct = (zoneData[3]?.pct ?? 0) + (zoneData[4]?.pct ?? 0);
  const z3pct   = zoneData[2]?.pct ?? 0;
  const insight =
    z2pct > 60    ? "Great aerobic base work 🎯"
    : hardPct > 20 ? "High intensity — monitor recovery ⚠️"
    : z3pct > 30   ? "Too much gray zone — polarize more ⚠️"
    : "Training distribution looks balanced";

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
      <p className="text-xs text-zinc-400">{insight}</p>
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

      <div className="flex items-center gap-3">
        <p className="text-5xl font-black leading-none" style={{ color: rColor }}>
          {readiness}
        </p>
        <div>
          <p className="text-sm font-semibold text-zinc-300">Race Readiness</p>
          <p className="text-xs font-medium" style={{ color: rColor }}>
            {readiness >= 70 ? "Ready to race" : readiness >= 50 ? "Building form" : "Rest needed"}
          </p>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs text-zinc-500">HRV Status — last 14 days</p>
        <div className="h-16">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sparkData} barSize={12}>
              <XAxis dataKey="day" stroke="#52525b" fontSize={8} />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 11 }}
                formatter={(_: number, __: string, item: { payload?: { label?: string } }) => [
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
                style={{ background: SPORT[a.sport].bg }}
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
              formatter={(v: number, name: string) => {
                if (name === "ctl") return [`${v.toFixed(1)}`, "CTL (Fitness)"];
                if (name === "atl") return [`${v.toFixed(1)}`, "ATL (Fatigue)"];
                if (name === "tsb") return [`${v > 0 ? "+" : ""}${v.toFixed(1)} · ${tsbLabel(v)}`, "TSB (Form)"];
                return [v, name];
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
  const [syncMsg, setSyncMsg]         = useState<string | null>(null);

  const [garminActs,    setGarminActs]    = useState<GarminActivityRow[]>([]);
  const [stravaActs,    setStravaActs]    = useState<StravaActivityRow[]>([]);
  const [dailyMetrics,  setDailyMetrics]  = useState<DailyMetricRow[]>([]);
  const [loading, setLoading]            = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [g, s, m] = await Promise.all([
        getGarminActivities({ limit: 60 }).catch(() => [] as GarminActivityRow[]),
        getStravaActivities({ limit: 60 }).catch(() => [] as StravaActivityRow[]),
        getGarminDailyMetrics({ days: 42 }).catch(() => [] as DailyMetricRow[]),
      ]);
      setGarminActs(g);
      setStravaActs(s);
      setDailyMetrics(m);
    } finally {
      setLoading(false);
    }
  }, []);

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

  // ── Sync ──
  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const [gr, sr] = await Promise.allSettled([postGarminSync(), postStravaSync({ days_back: 60 })]);
      const msgs: string[] = [];
      if (gr.status === "fulfilled") msgs.push(`Garmin: +${gr.value.synced_activities ?? 0}`);
      else msgs.push("Garmin failed");
      if (sr.status === "fulfilled") msgs.push(`Strava: +${sr.value.synced ?? 0}`);
      else msgs.push("Strava failed");
      setSyncMsg(msgs.join(" · "));
      await loadData();
    } catch {
      setSyncMsg("Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const noData = !loading && merged.length === 0;

  return (
    <div className="space-y-5 pb-12">

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
        </div>
        <button
          onClick={() => void handleSync()}
          disabled={syncing}
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 transition"
        >
          {syncing ? "↻ Syncing…" : "↻ Sync"}
        </button>
      </div>

      {syncMsg && (
        <p className="text-xs text-zinc-400 border border-zinc-800 rounded-lg px-4 py-2 bg-zinc-900/50">
          {syncMsg}
        </p>
      )}

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
                  ? { background: sp === "all" ? "#3f3f46" : SPORT[sp].bg }
                  : {}
              }
            >
              {sp === "all" ? "All" : sp}
            </button>
          ))}
        </div>

        <div className="flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-1 gap-1">
          {([7, 30, 90] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDateRange(d)}
              className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${
                dateRange === d
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* No data banner */}
      {noData && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-8 text-center">
          <p className="text-zinc-300 font-semibold">No training data found</p>
          <p className="text-sm text-zinc-500 mt-1">
            <Link href="/settings" className="text-emerald-400 underline">Connect a data source</Link>
            {" "}in Settings to see your dashboard.
          </p>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
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
