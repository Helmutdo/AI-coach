"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  getGarminActivities,
  getStravaActivities,
  uploadGarminCSV,
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
  return u.source === "strava"
    ? u.data.sport_type
    : (u.data.activity_type ?? "—");
}

function getName(u: UnifiedActivity): string {
  return u.source === "strava"
    ? u.data.name
    : (u.data.activity_name ?? "—");
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
  const { garminConnected, stravaConnected } = useAppStore();

  const [period, setPeriod] = useState<Period>("all");
  const [garminRows, setGarminRows] = useState<GarminActivityRow[]>([]);
  const [stravaRows, setStravaRows] = useState<StravaActivityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "garmin" | "csv" | "strava">("all");

  // CSV upload state
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvMsg, setCsvMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const periodCfg = PERIODS.find((p) => p.value === period) ?? PERIODS[0];

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    setErr(null);
    const fetches: Promise<void>[] = [];
    if (garminConnected !== false) {
      fetches.push(
        getGarminActivities({ limit: periodCfg.limit, days: periodCfg.days })
          .then(setGarminRows)
          .catch(() => {}),
      );
    }
    if (stravaConnected) {
      fetches.push(
        getStravaActivities({ limit: periodCfg.limit, days: periodCfg.days })
          .then(setStravaRows)
          .catch(() => {}),
      );
    }
    Promise.all(fetches)
      .catch((e) => setErr(e instanceof Error ? e.message : "Failed to load activities"))
      .finally(() => setLoading(false));
  }, [userId, garminConnected, stravaConnected, periodCfg.days, periodCfg.limit]);

  async function handleCSVUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvUploading(true);
    setCsvMsg(null);
    try {
      const res = await uploadGarminCSV(file);
      setCsvMsg(
        `Imported ${res.inserted} activities (${res.skipped} skipped).${
          res.errors.length ? ` ${res.errors.length} errors.` : ""
        }`
      );
      // Reload garmin activities to show newly imported ones
      const fresh = await getGarminActivities({ limit: periodCfg.limit, days: periodCfg.days });
      setGarminRows(fresh);
    } catch (ex) {
      setCsvMsg(ex instanceof Error ? ex.message : "Upload failed");
    } finally {
      setCsvUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

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
      {/* Header row */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Activities</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {garminRows.filter(r => r.source !== "csv").length} Garmin
            {csvCount > 0 && ` · ${csvCount} CSV`}
            {" "}· {stravaRows.length} Strava
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Period selector */}
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

          {/* Source filter */}
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

          {/* Type filter */}
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

          {/* CSV upload */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleCSVUpload}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={csvUploading || !userId}
              className="inline-flex items-center gap-2 rounded-lg border border-violet-500/50 bg-violet-500/10 px-4 py-2 text-sm font-medium text-violet-300 hover:bg-violet-500/20 disabled:opacity-50"
            >
              {csvUploading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Importing…
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M9.25 13.25a.75.75 0 001.5 0V4.636l2.955 3.129a.75.75 0 001.09-1.03l-4.25-4.5a.75.75 0 00-1.09 0l-4.25 4.5a.75.75 0 101.09 1.03L9.25 4.636v8.614z" />
                    <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                  </svg>
                  Upload CSV
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* CSV upload result */}
      {csvMsg && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            csvMsg.includes("error") || csvMsg.includes("failed")
              ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          }`}
        >
          {csvMsg}
          <button
            type="button"
            onClick={() => setCsvMsg(null)}
            className="ml-3 text-xs opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

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
        {!loading && filtered.length === 0 && !err && (
          <div className="flex flex-col items-center gap-4 px-4 py-16 text-center">
            {unified.length === 0 ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-10 w-10 text-zinc-600">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <p className="text-sm font-medium text-zinc-300">No training data yet</p>
                <p className="text-sm text-zinc-500">Upload a Garmin CSV or connect Strava to see your activities.</p>
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
