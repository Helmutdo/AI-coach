"use client";

import { useEffect } from "react";
import { getGarminStatus } from "@/lib/api";
import { useAppStore } from "@/store/appStore";

function formatSync(d: Date | null): string {
  if (!d) return "Never";
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function TopBar() {
  const { garminConnected, lastSync, setGarminConnected } = useAppStore();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getGarminStatus();
        if (!cancelled) setGarminConnected(s.active);
      } catch {
        if (!cancelled) setGarminConnected(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setGarminConnected]);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-6 backdrop-blur">
      <div className="text-sm text-zinc-500">
        <span className="text-zinc-400">Sync status:</span>{" "}
        <span
          className={
            garminConnected ? "font-medium text-emerald-400" : "font-medium text-amber-400"
          }
        >
          {garminConnected ? "Connected" : "Not connected"}
        </span>
      </div>
      <div className="text-sm text-zinc-500">
        <span className="text-zinc-400">Last sync:</span>{" "}
        <span className="font-mono text-zinc-300">{formatSync(lastSync)}</span>
      </div>
    </header>
  );
}
