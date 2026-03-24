"use client";

import { useSession } from "next-auth/react";
import { useEffect } from "react";

import { getAIStatus, getGarminStatus } from "@/lib/api";
import { useAppStore } from "@/store/appStore";

/**
 * Loads Garmin + AI status into Zustand on app load (after userId is known).
 */
export function AppStatusBootstrap() {
  const { status } = useSession();
  const userId = useAppStore((s) => s.userId);
  const setStatusFromApi = useAppStore((s) => s.setStatusFromApi);

  useEffect(() => {
    if (status !== "authenticated" || !userId) return;
    let cancelled = false;
    (async () => {
      try {
        const [g, ai] = await Promise.all([getGarminStatus(), getAIStatus()]);
        if (!cancelled) {
          setStatusFromApi({
            garminActive: g.active,
            aiConfigured: ai.configured,
            aiProvider: ai.provider ?? null,
          });
        }
      } catch {
        if (!cancelled) {
          setStatusFromApi({
            garminActive: false,
            aiConfigured: false,
            aiProvider: null,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, userId, setStatusFromApi]);

  return null;
}
