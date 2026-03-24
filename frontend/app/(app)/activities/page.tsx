"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { getGarminActivities, type GarminActivityRow } from "@/lib/api";
import { useAppStore } from "@/store/appStore";

function fmtDuration(sec: number | null) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return `${m}m ${s}s`;
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

export default function ActivitiesPage() {
  const userId = useAppStore((s) => s.userId);
  const [rows, setRows] = useState<GarminActivityRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("all");

  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const data = await getGarminActivities({ limit: 100 });
        setRows(data);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to load activities");
      }
    })();
  }, [userId]);

  const types = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (r.activity_type) s.add(r.activity_type);
    }
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    if (typeFilter === "all") return rows;
    return rows.filter((r) => (r.activity_type ?? "") === typeFilter);
  }, [rows, typeFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Activities</h1>
          <p className="mt-1 text-sm text-zinc-500">Synced from Garmin (database).</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="type-filter" className="text-sm text-zinc-500">
            Type
          </label>
          <select
            id="type-filter"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
          >
            <option value="all">All</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
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
              <th className="px-3 py-3">Type</th>
              <th className="px-3 py-3">Duration</th>
              <th className="px-3 py-3">Avg HR</th>
              <th className="px-3 py-3">Load</th>
              <th className="px-3 py-3">Aerobic</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {filtered.map((r) => {
              const open = expanded === r.id;
              return (
                <Fragment key={r.id}>
                  <tr
                    className="cursor-pointer bg-zinc-950/50 hover:bg-zinc-900/80"
                    onClick={() => setExpanded(open ? null : r.id)}
                  >
                    <td className="px-3 py-3 text-zinc-500">{open ? "▼" : "▶"}</td>
                    <td className="px-3 py-3 text-zinc-300">{fmtDate(r.start_time)}</td>
                    <td className="px-3 py-3 text-zinc-200">{r.activity_type ?? "—"}</td>
                    <td className="px-3 py-3 text-zinc-300">{fmtDuration(r.duration_seconds)}</td>
                    <td className="px-3 py-3 text-zinc-300">{r.avg_heart_rate ?? "—"}</td>
                    <td className="px-3 py-3 text-zinc-300">
                      {r.training_load != null ? r.training_load.toFixed(1) : "—"}
                    </td>
                    <td className="px-3 py-3 text-zinc-300">
                      {r.aerobic_effect != null ? r.aerobic_effect.toFixed(2) : "—"}
                    </td>
                  </tr>
                  {open && (
                    <tr key={`${r.id}-detail`} className="bg-zinc-900/40">
                      <td colSpan={7} className="px-4 py-4 text-xs text-zinc-400">
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          <div>
                            <span className="text-zinc-500">Name: </span>
                            {r.activity_name ?? "—"}
                          </div>
                          <div>
                            <span className="text-zinc-500">Activity ID: </span>
                            {r.activity_id}
                          </div>
                          <div>
                            <span className="text-zinc-500">Distance (m): </span>
                            {r.distance_meters != null ? r.distance_meters.toFixed(1) : "—"}
                          </div>
                          <div>
                            <span className="text-zinc-500">Max HR: </span>
                            {r.max_heart_rate ?? "—"}
                          </div>
                          <div>
                            <span className="text-zinc-500">Calories: </span>
                            {r.calories ?? "—"}
                          </div>
                          <div>
                            <span className="text-zinc-500">Anaerobic: </span>
                            {r.anaerobic_effect != null ? r.anaerobic_effect.toFixed(2) : "—"}
                          </div>
                          <div>
                            <span className="text-zinc-500">Synced: </span>
                            {r.synced_at ? fmtDate(r.synced_at) : "—"}
                          </div>
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
          <p className="px-4 py-8 text-center text-sm text-zinc-500">No activities in database.</p>
        )}
      </div>
    </div>
  );
}
