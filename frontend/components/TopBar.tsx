"use client";

import { useEffect } from "react";
import { getAIStatus, getGarminStatus, getStravaStatus } from "@/lib/api";
import { useAppStore } from "@/store/appStore";

function formatSync(d: Date | null): string {
  if (!d) return "Never";
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function TopBar() {
  const { garminConnected, stravaConnected, lastSync, setStatusFromApi, userId } = useAppStore();
  const fitnessConnected = garminConnected || stravaConnected;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const [g, st, ai] = await Promise.all([
          getGarminStatus(),
          getStravaStatus(),
          getAIStatus(),
        ]);
        if (!cancelled) {
          setStatusFromApi({
            garminActive: g.active,
            stravaConnected: st.connected,
            stravaOAuthConfigured: st.oauth_configured ?? true,
            stravaAthleteName: st.athlete_name,
            aiConfigured: ai.configured,
            aiProvider: ai.provider ?? null,
          });
        }
      } catch {
        if (!cancelled) {
          setStatusFromApi({
            garminActive: false,
            stravaConnected: false,
            stravaAthleteName: null,
            aiConfigured: false,
            aiProvider: null,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setStatusFromApi, userId]);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-6 backdrop-blur">
      <div className="text-sm text-zinc-500">
        <span className="text-zinc-400">Sync status:</span>{" "}
        <span
          className={
            fitnessConnected ? "font-medium text-emerald-400" : "font-medium text-amber-400"
          }
        >
          {fitnessConnected ? "Connected" : "Not connected"}
        </span>
      </div>
      <div className="text-sm text-zinc-500">
        <span className="text-zinc-400">Last sync:</span>{" "}
        <span className="font-mono text-zinc-300">{formatSync(lastSync)}</span>
      </div>
    </header>
  );
}
