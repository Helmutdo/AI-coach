"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getAIStatus,
  getCoachAnalysis,
  getGarminActivities,
  getGarminStatus,
  getGarminSummary,
  getStravaActivities,
  getStravaStatus,
  type CoachAnalysis,
  type GarminActivityRow,
  type GarminSummaryResponse,
  type StravaActivityRow,
} from "@/lib/api";
import { useAppStore } from "@/store/appStore";

function dayKeys(days: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function aggregateLoad30(activities: GarminActivityRow[]) {
  const keys = dayKeys(30);
  const map = new Map(keys.map((k) => [k, 0]));
  for (const a of activities) {
    if (!a.start_time) continue;
    const d = a.start_time.slice(0, 10);
    if (!map.has(d)) continue;
    const tl = Number(a.training_load ?? 0);
    map.set(d, (map.get(d) ?? 0) + tl);
  }
  return keys.map((k) => ({ day: k.slice(5), load: map.get(k) ?? 0 }));
}

function aggregateDuration14(
  garmin: GarminActivityRow[],
  strava: StravaActivityRow[],
) {
  const keys = dayKeys(14);
  const map = new Map(keys.map((k) => [k, 0]));
  for (const a of garmin) {
    if (!a.start_time) continue;
    const d = a.start_time.slice(0, 10);
    if (!map.has(d)) continue;
    map.set(d, (map.get(d) ?? 0) + Number(a.duration_seconds ?? 0));
  }
  for (const a of strava) {
    if (!a.start_date) continue;
    const d = a.start_date.slice(0, 10);
    if (!map.has(d)) continue;
    map.set(d, (map.get(d) ?? 0) + Number(a.moving_time ?? 0));
  }
  return keys.map((k) => ({
    day: k.slice(5),
    minutes: Math.round((map.get(k) ?? 0) / 60),
  }));
}

export default function DashboardPage() {
  const { setStatusFromApi, userId, stravaConnected } = useAppStore();
  const [summary, setSummary] = useState<GarminSummaryResponse | null>(null);
  const [activities, setActivities] = useState<GarminActivityRow[]>([]);
  const [stravaActivities, setStravaActivities] = useState<StravaActivityRow[]>([]);
  const [garminOk, setGarminOk] = useState<boolean | null>(null);
  const [aiOk, setAiOk] = useState<boolean | null>(null);
  const [analysis, setAnalysis] = useState<CoachAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisErr, setAnalysisErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoadErr(null);
    try {
      const [st, strava, ai, s, acts, stravaActs] = await Promise.all([
        getGarminStatus(),
        getStravaStatus(),
        getAIStatus(),
        getGarminSummary(),
        getGarminActivities({ limit: 200 }),
        getStravaActivities({ limit: 200 }),
      ]);
      setStatusFromApi({
        garminActive: st.active,
        stravaConnected: strava.connected,
        stravaOAuthConfigured: strava.oauth_configured ?? true,
        stravaAthleteName: strava.athlete_name,
        aiConfigured: ai.configured,
        aiProvider: ai.provider,
      });
      setGarminOk(st.active);
      setAiOk(ai.configured);
      setSummary(s);
      setActivities(acts);
      setStravaActivities(stravaActs);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Failed to load dashboard");
    }
  }, [userId, setStatusFromApi]);

  useEffect(() => {
    if (!userId) return;
    void load();
  }, [load, userId]);

  const loadSeries = useMemo(() => aggregateLoad30(activities), [activities]);
  const durSeries = useMemo(
    () => aggregateDuration14(activities, stravaActivities),
    [activities, stravaActivities],
  );

  async function runAnalysis() {
    setAnalysisLoading(true);
    setAnalysisErr(null);
    try {
      const r = await getCoachAnalysis();
      setAnalysis(r);
    } catch (e) {
      setAnalysisErr(e instanceof Error ? e.message : "Analysis failed");
      setAnalysis(null);
    } finally {
      setAnalysisLoading(false);
    }
  }

  const bb = summary?.current_body_battery;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Overview of load, recovery, and quick AI insights.
        </p>
      </div>

      {garminOk === false && !stravaConnected && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Connect Garmin or Strava in{" "}
          <Link href="/settings" className="font-medium text-emerald-400 underline">
            Settings
          </Link>{" "}
          to get started.
        </div>
      )}
      {aiOk === false && (
        <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
          Add your AI API key in{" "}
          <Link href="/settings" className="font-medium text-emerald-400 underline">
            Settings
          </Link>{" "}
          to chat with your coach.
        </div>
      )}

      {loadErr && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {loadErr}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Weekly load</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-100">
            {summary?.activities_this_week ?? "—"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">Activities this ISO week</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Avg sleep score</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-100">
            {summary?.avg_sleep_score != null ? summary.avg_sleep_score.toFixed(1) : "—"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">This week (days with data)</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Body battery</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-100">
            {bb ? `${bb.min ?? "—"} – ${bb.max ?? "—"}` : "—"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {bb?.date ? `Latest: ${bb.date}` : "No data"}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">HRV status</p>
          <p className="mt-2 text-lg font-semibold text-zinc-100">
            {summary?.hrv_status_mode ?? "—"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">Mode this week</p>
        </div>
        {stravaConnected && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Strava activities</p>
            <p className="mt-2 text-2xl font-semibold text-zinc-100">
              {stravaActivities.length}
            </p>
            <p className="mt-1 text-xs text-zinc-500">Loaded (last 200)</p>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="mb-4 text-sm font-medium text-zinc-300">Training load (30 days)</h2>
          <div className="h-64 min-h-[16rem] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={loadSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                <XAxis dataKey="day" stroke="#71717a" fontSize={11} />
                <YAxis stroke="#71717a" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#18181b",
                    border: "1px solid #3f3f46",
                    borderRadius: "8px",
                  }}
                />
                <Line type="monotone" dataKey="load" stroke="#34d399" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="mb-4 text-sm font-medium text-zinc-300">Activity duration / day (14 days, Garmin + Strava)</h2>
          <div className="h-64 min-h-[16rem] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={durSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                <XAxis dataKey="day" stroke="#71717a" fontSize={11} />
                <YAxis stroke="#71717a" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#18181b",
                    border: "1px solid #3f3f46",
                    borderRadius: "8px",
                  }}
                />
                <Bar dataKey="minutes" fill="#22d3ee" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-zinc-300">Quick analysis</h2>
          <button
            type="button"
            onClick={() => void runAnalysis()}
            disabled={analysisLoading}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {analysisLoading ? "Running…" : "Run analysis"}
          </button>
        </div>
        {analysisErr && (
          <p className="mt-3 text-sm text-red-400">{analysisErr}</p>
        )}
        {analysis && (
          <div className="mt-4 rounded-lg border border-zinc-700 bg-zinc-950/80 p-4 font-mono text-xs text-zinc-300">
            <pre className="whitespace-pre-wrap break-words">
              {JSON.stringify(analysis, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
