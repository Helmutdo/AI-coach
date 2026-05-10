"use client";

import { useMemo } from "react";

type SportType = "swim" | "bike" | "run" | "other";

const SPORT_COLORS: Record<SportType, string> = {
  swim: "#378ADD",
  bike: "#EF9F27",
  run:  "#1D9E75",
  other: "#6B7280",
};

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type DayData = {
  date: string;
  sports: Set<SportType>;
  count: number;
};

function cellColor(sports: Set<SportType>, count: number): string {
  if (count === 0) return "#27272a";
  if (sports.size >= 3) return "#7F77DD";
  const arr = Array.from(sports);
  if (arr.includes("swim") && arr.includes("bike")) return "#7C3AED";
  if (arr.includes("bike") && arr.includes("run"))  return "#D97706";
  if (arr.includes("swim") && arr.includes("run"))  return "#0891B2";
  return SPORT_COLORS[arr[0] as SportType] ?? "#52525b";
}

export function ActivityHeatmap({
  activities,
}: {
  activities: { date: string; sport: SportType | string }[];
}) {
  const WEEKS = 26;

  const { grid, months } = useMemo(() => {
    const today = new Date();
    const dayMap = new Map<string, DayData>();

    for (const a of activities) {
      if (!a.date) continue;
      if (!dayMap.has(a.date)) {
        dayMap.set(a.date, { date: a.date, sports: new Set(), count: 0 });
      }
      const d = dayMap.get(a.date)!;
      d.sports.add((a.sport ?? "other") as SportType);
      d.count++;
    }

    const cols: DayData[][] = [];
    for (let w = WEEKS - 1; w >= 0; w--) {
      const week: DayData[] = [];
      for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
        const d = new Date(today);
        d.setDate(today.getDate() - (w * 7) - (6 - dayOfWeek));
        const key = isoDate(d);
        week.push(dayMap.get(key) ?? { date: key, sports: new Set(), count: 0 });
      }
      cols.push(week);
    }

    const monthLabels: { label: string; col: number }[] = [];
    let lastMonth = -1;
    cols.forEach((week, i) => {
      const m = new Date(week[0].date).getMonth();
      if (m !== lastMonth) {
        monthLabels.push({
          label: new Date(week[0].date).toLocaleString("default", { month: "short" }),
          col: i,
        });
        lastMonth = m;
      }
    });

    return { grid: cols, months: monthLabels };
  }, [activities]);

  const activeDays = grid.flat().filter((d) => d.count > 0).length;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-200">Training Calendar</h2>
          <p className="text-xs text-zinc-500">{activeDays} active days in last 26 weeks</p>
        </div>
        <div className="flex items-center gap-3">
          {(Object.entries(SPORT_COLORS) as [SportType, string][])
            .filter(([sp]) => sp !== "other")
            .map(([sp, color]) => (
              <span key={sp} className="flex items-center gap-1 text-[10px] text-zinc-500">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
                {sp}
              </span>
            ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-max">
          <div className="flex mb-1" style={{ paddingLeft: 24 }}>
            {grid.map((_, i) => {
              const mLabel = months.find((m) => m.col === i);
              return (
                <div key={i} className="w-3.5 mx-px text-[9px] text-zinc-600">
                  {mLabel ? mLabel.label : ""}
                </div>
              );
            })}
          </div>

          <div className="flex gap-0">
            <div className="flex flex-col gap-px mr-1">
              {DAYS.map((d, i) => (
                <div key={d} className="h-3 w-5 text-[9px] text-zinc-600 flex items-center">
                  {i % 2 === 0 ? d : ""}
                </div>
              ))}
            </div>

            {grid.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-px mx-px">
                {week.map((day) => (
                  <div
                    key={day.date}
                    title={
                      day.count > 0
                        ? `${day.date} — ${day.count} session${day.count > 1 ? "s" : ""} (${Array.from(day.sports).join(", ")})`
                        : day.date
                    }
                    className="h-3 w-3 rounded-sm cursor-default transition-opacity hover:opacity-80"
                    style={{ background: cellColor(day.sports, day.count) }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
