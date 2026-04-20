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
  | { source: "garmin"; data: GarminActivityRow }
  | { source: "strava"; data: StravaActivityRow };

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
  return u.source === "garmin" ? (u.data.start_time ?? "") : u.data.start_date;
}

function getType(u: UnifiedActivity): string {
  return u.source === "garmin"
    ? (u.data.activity_type ?? "—")
    : u.data.sport_type;
}

function getName(u: UnifiedActivity): string {
  return u.source === "garmin"
    ? (u.data.activity_name ?? "—")
    : u.data.name;
}

function getDuration(u: UnifiedActivity): number | null {
  return u.source === "garmin" ? u.data.duration_seconds : u.data.moving_time;
}

function getAvgHR(u: UnifiedActivity): number | null {
  return u.source === "garmin" ? u.data.avg_heart_rate : u.data.avg_heartrate;
}

function getDistance(u: UnifiedActivity): number | null {
  return u.source === "garmin" ? u.data.distance_meters : u.data.distance;
}

function getId(u: UnifiedActivity): string {
  return u.source === "garmin" ? String(u.data.id) : u.data.id;
}

export default function ActivitiesPage() {
  const userId = useAppStore((s) => s.userId);
  const { garminConnected, stravaConnected } = useAppStore();
  const [garminRows, setGarminRows] = useState<GarminActivityRow[]>([]);
  const [stravaRows, setStravaRows] = useState<StravaActivityRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "garmin" | "strava">("all");

  useEffect(() => {
    if (!userId) return;
    const fetches: Promise<void>[] = [];
    if (garminConnected !== false) {
      fetches.push(
        getGarminActivities({ limit: 100 })
          .then(setGarminRows)
          .catch(() => {}),
      );
    }
    if (stravaConnected) {
      fetches.push(
        getStravaActivities({ limit: 100 })
          .then(setStravaRows)
          .catch(() => {}),
      );
    }
    Promise.all(fetches).catch((e) => {
      setErr(e instanceof Error ? e.message : "Failed to load activities");
    });
  }, [userId, garminConnected, stravaConnected]);

  const unified: UnifiedActivity[] = useMemo(() => {
    const out: UnifiedActivity[] = [
      ...garminRows.map((d) => ({ source: "garmin" as const, data: d })),
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Activities</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {garminRows.length} Garmin · {stravaRows.length} Strava
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="source-filter" className="text-sm text-zinc-500">Source</label>
            <select
              id="source-filter"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as "all" | "garmin" | "strava")}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            >
              <option value="all">All</option>
              <option value="garmin">Garmin</option>
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
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          u.source === "garmin"
                            ? "bg-emerald-900/50 text-emerald-300"
                            : "bg-orange-900/50 text-orange-300"
                        }`}
                      >
                        {u.source === "garmin" ? "Garmin" : "Strava"}
                      </span>
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
                          {u.source === "garmin" ? (
                            <>
                              <div><span className="text-zinc-500">Training load: </span>{u.data.training_load?.toFixed(1) ?? "—"}</div>
                              <div><span className="text-zinc-500">Aerobic effect: </span>{u.data.aerobic_effect?.toFixed(2) ?? "—"}</div>
                              <div><span className="text-zinc-500">Max HR: </span>{u.data.max_heart_rate ?? "—"}</div>
                              <div><span className="text-zinc-500">Calories: </span>{u.data.calories ?? "—"}</div>
                            </>
                          ) : (
                            <>
                              <div><span className="text-zinc-500">Suffer score: </span>{u.data.suffer_score ?? "—"}</div>
                              <div><span className="text-zinc-500">Elevation gain: </span>{u.data.total_elevation_gain != null ? `${u.data.total_elevation_gain.toFixed(0)} m` : "—"}</div>
                              <div><span className="text-zinc-500">Max HR: </span>{u.data.max_heartrate ?? "—"}</div>
                              <div><span className="text-zinc-500">Avg power: </span>{u.data.avg_watts != null ? `${u.data.avg_watts.toFixed(0)} W` : "—"}</div>
                              <div><span className="text-zinc-500">PRs: </span>{u.data.pr_count ?? "—"}</div>
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
        {filtered.length === 0 && !err && (
          <p className="px-4 py-8 text-center text-sm text-zinc-500">No activities found.</p>
        )}
      </div>
    </div>
  );
}
