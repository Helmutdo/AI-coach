"use client";

import { useSession } from "next-auth/react";
import { useEffect } from "react";

import { getAIStatus, getGarminStatus, getStravaStatus, getUserMe } from "@/lib/api";
import { useAppStore } from "@/store/appStore";

/**
 * Loads Garmin + AI status into Zustand on app load (after userId is known).
 */
export function AppStatusBootstrap() {
  const { status } = useSession();
  const userId = useAppStore((s) => s.userId);
  const setStatusFromApi = useAppStore((s) => s.setStatusFromApi);
  const setDisplayName = useAppStore((s) => s.setDisplayName);

  useEffect(() => {
    if (status !== "authenticated" || !userId) return;
    let cancelled = false;
    (async () => {
      try {
        const [g, st, ai, me] = await Promise.all([
          getGarminStatus(),
          getStravaStatus(),
          getAIStatus(),
          getUserMe().catch(() => null),
        ]);
        if (!cancelled) {
          setStatusFromApi({
            garminActive: g.active,
            garminHasData: g.has_data,
            stravaConnected: st.connected,
            stravaOAuthConfigured: st.oauth_configured ?? true,
            stravaAthleteName: st.athlete_name,
            aiConfigured: ai.configured,
            aiProvider: ai.provider ?? null,
          });
          if (me?.name) setDisplayName(me.name);
        }
      } catch (err) {
        console.error("[AppStatusBootstrap] Failed to load status from backend:", err);
        if (!cancelled) {
          setStatusFromApi({
            garminActive: false,
            garminHasData: false,
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
  }, [status, userId, setStatusFromApi, setDisplayName]);

  return null;
}
