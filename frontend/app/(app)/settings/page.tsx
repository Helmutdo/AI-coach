"use client";

import { signOut, useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { GarminLoginCard } from "@/components/garmin/GarminLoginCard";
import { StravaConnectButton } from "@/components/strava/StravaConnectButton";
import {
  deleteGarminDisconnect,
  deleteUserData,
  getAIStatus,
  getGarminStatus,
  getStravaStatus,
  postGarminSync,
  postStravaSync,
} from "@/lib/api";
import { modelBadgeLabel } from "@/lib/aiProviders";
import { useAppStore } from "@/store/appStore";

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className ?? "h-4 w-4"}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function formatSync(d: Date | null): string {
  if (!d) return "Never";
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const {
    garminConnected,
    stravaConnected,
    stravaAthleteName,
    aiConfigured,
    setStatusFromApi,
    setLastSync,
    userId,
    lastSync,
  } = useAppStore();

  const [garminEmail, setGarminEmail] = useState<string | null>(null);
  const [aiModel, setAiModel] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [deletingData, setDeletingData] = useState(false);
  const [stravaToast, setStravaToast] = useState<string | null>(null);
  const [stravaOAuthErr, setStravaOAuthErr] = useState<string | null>(null);

  const refreshStatuses = useCallback(async () => {
    if (!userId) return;
    try {
      const [s, st, ai] = await Promise.all([
        getGarminStatus(),
        getStravaStatus(),
        getAIStatus(),
      ]);
      setStatusFromApi({
        garminActive: s.active,
        stravaConnected: st.connected,
        stravaOAuthConfigured: st.oauth_configured ?? true,
        stravaAthleteName: st.athlete_name,
        aiConfigured: ai.configured,
        aiProvider: ai.model ?? null,
      });
      setGarminEmail(s.garmin_email ?? null);
      setAiModel(ai.model ?? null);
    } catch {
      setStatusFromApi({
        garminActive: false,
        stravaConnected: false,
        stravaAthleteName: null,
        aiConfigured: false,
        aiProvider: null,
      });
      setGarminEmail(null);
      setAiModel(null);
    }
  }, [userId, setStatusFromApi]);

  useEffect(() => {
    void refreshStatuses();
  }, [refreshStatuses]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("strava_connected");
    const err = params.get("strava_error");
    if (connected !== "true" && !err) return;
    if (connected === "true") {
      setStravaOAuthErr(null);
      setStravaToast("Strava connected successfully");
      void refreshStatuses();
    }
    if (err) {
      setStravaOAuthErr(decodeURIComponent(err));
    }
    params.delete("strava_connected");
    params.delete("strava_error");
    const q = params.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  }, [pathname, router, refreshStatuses]);

  useEffect(() => {
    if (!stravaToast) return;
    const t = window.setTimeout(() => setStravaToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [stravaToast]);

  async function disconnectGarmin() {
    setDisconnecting(true);
    try {
      await deleteGarminDisconnect();
      setGarminEmail(null);
      await refreshStatuses();
    } catch (e) {
      console.error(e);
    } finally {
      setDisconnecting(false);
    }
  }

  async function syncAllSources() {
    setSyncing(true);
    setSyncMsg(null);
    setStravaOAuthErr(null);
    const parts: string[] = [];
    const [garminR, stravaR] = await Promise.allSettled([
      postGarminSync(),
      postStravaSync({ days_back: 60 }),
    ]);
    if (garminR.status === "fulfilled") {
      const r = garminR.value;
      parts.push(
        `Garmin: ${r.synced_activities} activities, ${r.synced_days} days of metrics.`
      );
    } else {
      const msg =
        garminR.reason instanceof Error ? garminR.reason.message : "Garmin sync failed";
      parts.push(`Garmin: ${msg}`);
    }
    if (stravaR.status === "fulfilled") {
      const r = stravaR.value;
      const errNote =
        r.errors?.length > 0 ? ` (warnings: ${r.errors.length})` : "";
      parts.push(`Strava: ${r.synced} new, ${r.updated} updated${errNote}.`);
    } else {
      const msg =
        stravaR.reason instanceof Error ? stravaR.reason.message : "Strava sync failed";
      parts.push(`Strava: ${msg}`);
    }
    setLastSync(new Date());
    await refreshStatuses();
    setSyncMsg(parts.join(" "));
    setSyncing(false);
  }

  function confirmDeleteData() {
    const ok = window.confirm(
      "This permanently deletes your synced activities, daily metrics, and coach chat history from our servers. Continue?"
    );
    if (!ok) return;
    void (async () => {
      setDeletingData(true);
      try {
        await deleteUserData();
        setLastSync(null);
        setSyncMsg("All your training data has been deleted.");
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Delete failed");
      } finally {
        setDeletingData(false);
      }
    })();
  }

  if (status === "loading") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner className="h-8 w-8 text-zinc-400" />
      </div>
    );
  }

  const name = session?.user?.name ?? "—";
  const email = session?.user?.email ?? "—";
  const avatar = session?.user?.image;

  return (
    <div className="mx-auto max-w-2xl space-y-8 pb-12">
      {stravaToast && (
        <div
          className="fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border border-emerald-500/40 bg-emerald-950/95 px-4 py-3 text-sm text-emerald-100 shadow-lg"
          role="status"
        >
          {stravaToast}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500">Account, integrations, and data.</p>
      </div>

      {/* Profile */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
        <h2 className="text-lg font-medium text-zinc-200">Profile</h2>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatar}
                alt=""
                width={64}
                height={64}
                className="h-16 w-16 shrink-0 rounded-full border-2 border-zinc-700 object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xl text-zinc-500">
                ?
              </div>
            )}
            <div>
              <p className="font-medium text-zinc-100">{name}</p>
              <p className="text-sm text-zinc-500">{email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl: "/" })}
            className="shrink-0 rounded-lg border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
          >
            Sign out
          </button>
        </div>
      </section>

      {/* Fitness data sources */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
        <h2 className="text-lg font-medium text-zinc-200">Fitness Data Sources</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Connect Garmin, Strava, or both to sync activities.
        </p>

        {stravaOAuthErr && (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
            {stravaOAuthErr}
          </p>
        )}

        <div className="mt-6 grid gap-8 md:grid-cols-2">
          <div className="flex flex-col rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium text-zinc-200">Garmin Connect</h3>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                  garminConnected
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-red-500/15 text-red-400"
                }`}
              >
                {garminConnected ? "Connected" : "Disconnected"}
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">Direct sync via credentials</p>
            <div className="mt-4 flex flex-1 flex-col">
              {garminConnected ? (
                <>
                  {garminEmail && (
                    <p className="text-sm text-zinc-400">
                      <span className="text-zinc-500">Signed in as </span>
                      <span className="font-mono text-zinc-200">{garminEmail}</span>
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void disconnectGarmin()}
                    disabled={disconnecting || !userId}
                    className="mt-4 w-fit rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                  >
                    {disconnecting ? "Disconnecting…" : "Disconnect"}
                  </button>
                </>
              ) : (
                <GarminLoginCard userId={userId} onConnected={() => refreshStatuses()} />
              )}
            </div>
          </div>

          <div className="flex flex-col rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium text-zinc-200">Strava</h3>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                  stravaConnected
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-red-500/15 text-red-400"
                }`}
              >
                {stravaConnected ? "Connected" : "Disconnected"}
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">OAuth — no password needed</p>
            <div className="mt-4 flex flex-1 flex-col justify-center">
              <StravaConnectButton
                userId={userId}
                connected={stravaConnected}
                athleteName={stravaAthleteName}
                onConnected={async () => {
                  await refreshStatuses();
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* AI Coach */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium text-zinc-200">AI Coach</h2>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
              aiConfigured
                ? "bg-violet-500/15 text-violet-300"
                : "bg-red-500/15 text-red-400"
            }`}
          >
            {aiConfigured ? "Active" : "Not configured"}
          </span>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <span className="text-zinc-500">Provider:</span>
            <span className="font-medium text-zinc-200">OpenRouter</span>
          </div>
          {aiModel && (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <span className="text-zinc-500">Model:</span>
              <span className="font-mono text-zinc-200">{modelBadgeLabel(aiModel)}</span>
            </div>
          )}
          {!aiConfigured && (
            <p className="mt-2 text-sm text-amber-300/80">
              The server OPEN_ROUTER_APIKEY is not set — contact your administrator.
            </p>
          )}
        </div>
      </section>

      {/* Data & Sync */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
        <h2 className="text-lg font-medium text-zinc-200">Data &amp; sync</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Last sync: <span className="font-mono text-zinc-300">{formatSync(lastSync)}</span>
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void syncAllSources()}
            disabled={syncing || !userId}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {syncing && <Spinner className="h-4 w-4 text-cyan-300" />}
            {syncing ? "Syncing…" : "Sync all sources"}
          </button>
          <button
            type="button"
            onClick={confirmDeleteData}
            disabled={deletingData || !userId}
            className="rounded-lg border border-red-500/50 bg-red-950/40 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-950/70 disabled:opacity-50"
          >
            {deletingData ? "Deleting…" : "Delete all my data"}
          </button>
        </div>
        {syncMsg && (
          <p
            className={`mt-3 text-sm ${
              syncMsg.includes("Garmin:") || syncMsg.includes("Strava:") || syncMsg.includes("deleted")
                ? "text-emerald-400/90"
                : "text-amber-200"
            }`}
          >
            {syncMsg}
          </p>
        )}
      </section>
    </div>
  );
}
