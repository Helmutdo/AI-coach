"use client";

import { useSession } from "next-auth/react";
import { useEffect } from "react";

import { postUsersMe } from "@/lib/api";
import { useAppStore } from "@/store/appStore";

/**
 * Syncs backend user id for X-User-Id: prefers session.backendUserId from JWT,
 * falls back to POST /api/users/me.
 */
export function UserSync() {
  const { data: session, status } = useSession();
  const setUserId = useAppStore((s) => s.setUserId);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user) {
      if (status === "unauthenticated") setUserId(null);
      return;
    }

    const backendId = session.user.backendUserId;
    if (backendId) {
      setUserId(backendId);
      return;
    }

    const u = session.user;
    let cancelled = false;

    (async () => {
      try {
        const row = await postUsersMe({
          google_id: u.id ?? "",
          email: u.email ?? "",
          name: u.name ?? "",
          avatar_url: u.image ?? null,
        });
        if (!cancelled) setUserId(row.id);
      } catch {
        if (!cancelled) setUserId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, session, setUserId]);

  return null;
}
