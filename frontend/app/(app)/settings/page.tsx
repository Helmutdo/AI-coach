"use client";

import { signOut, useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

import { AIProviderCard } from "@/components/ai/AIProviderCard";
import { GarminLoginCard } from "@/components/garmin/GarminLoginCard";
import {
  deleteAIConfigure,
  deleteGarminDisconnect,
  deleteUserData,
  getAIStatus,
  getGarminStatus,
  postGarminSync,
} from "@/lib/api";
import { providerBadgeLabel, type AIProviderId } from "@/lib/aiProviders";
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
  const {
    garminConnected,
    aiConfigured,
    setStatusFromApi,
    setLastSync,
    userId,
    lastSync,
  } = useAppStore();

  const [garminEmail, setGarminEmail] = useState<string | null>(null);
  const [aiPreview, setAiPreview] = useState<string | null>(null);
  const [coachProvider, setCoachProvider] = useState<AIProviderId>("anthropic");
  const [showAiChange, setShowAiChange] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [removingAi, setRemovingAi] = useState(false);
  const [deletingData, setDeletingData] = useState(false);

  const refreshStatuses = useCallback(async () => {
    if (!userId) return;
    try {
      const [s, ai] = await Promise.all([getGarminStatus(), getAIStatus()]);
      setStatusFromApi({
        garminActive: s.active,
        aiConfigured: ai.configured,
        aiProvider: ai.provider ?? null,
      });
      setGarminEmail(s.garmin_email ?? null);
      setAiPreview(ai.key_preview ?? null);
      const p = ai.provider;
      setCoachProvider(
        p && ["anthropic", "openai", "google"].includes(p) ? (p as AIProviderId) : "anthropic"
      );
    } catch {
      setStatusFromApi({
        garminActive: false,
        aiConfigured: false,
        aiProvider: null,
      });
      setGarminEmail(null);
      setAiPreview(null);
    }
  }, [userId, setStatusFromApi]);

  useEffect(() => {
    void refreshStatuses();
  }, [refreshStatuses]);

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

  async function removeAi() {
    setRemovingAi(true);
    try {
      await deleteAIConfigure();
      setShowAiChange(false);
      await refreshStatuses();
    } catch (e) {
      console.error(e);
    } finally {
      setRemovingAi(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await postGarminSync();
      setLastSync(new Date());
      await refreshStatuses();
      setSyncMsg(
        `Synced ${r.synced_activities} activities, ${r.synced_days} days of metrics.`
      );
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  function confirmDeleteData() {
    const ok = window.confirm(
      "This permanently deletes your synced activities, daily metrics, and coach chat history from our servers. Your Garmin and AI settings are not removed. Continue?"
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

      {/* Garmin */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium text-zinc-200">Garmin Connect</h2>
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

        {garminConnected ? (
          <div className="mt-4 space-y-4">
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
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        ) : (
          <div className="mt-6 flex justify-center">
            <GarminLoginCard userId={userId} onConnected={() => refreshStatuses()} />
          </div>
        )}
      </section>

      {/* AI Coach */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium text-zinc-200">AI Coach</h2>
          {aiConfigured && (
            <span className="inline-flex max-w-[min(100%,14rem)] items-center truncate rounded-full bg-violet-500/15 px-2.5 py-1 text-xs font-medium text-violet-300">
              {providerBadgeLabel(coachProvider)}
            </span>
          )}
        </div>

        {aiConfigured && aiPreview && (
          <p className="mt-3 font-mono text-sm text-zinc-400">
            Key: <span className="text-zinc-200">{aiPreview}</span>
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {aiConfigured && (
            <button
              type="button"
              onClick={() => setShowAiChange((v) => !v)}
              className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
            >
              {showAiChange ? "Cancel" : "Change provider"}
            </button>
          )}
          {aiConfigured && (
            <button
              type="button"
              onClick={() => void removeAi()}
              disabled={removingAi || !userId}
              className="rounded-lg border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              {removingAi ? "Removing…" : "Remove"}
            </button>
          )}
        </div>

        {aiConfigured && showAiChange && (
          <div className="mt-6">
            <AIProviderCard
              userId={userId}
              initialProvider={coachProvider}
              submitLabel="Save API key"
              showFourthSlot
              onSaved={async () => {
                setShowAiChange(false);
                await refreshStatuses();
              }}
            />
          </div>
        )}

        {!aiConfigured && !showAiChange && (
          <div className="mt-6">
            <p className="mb-4 text-sm text-zinc-500">Configure an AI provider to use the coach.</p>
            <AIProviderCard
              userId={userId}
              initialProvider="anthropic"
              submitLabel="Save API key"
              onSaved={async () => {
                await refreshStatuses();
              }}
            />
          </div>
        )}
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
            onClick={() => void syncNow()}
            disabled={syncing || !userId}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {syncing && <Spinner className="h-4 w-4 text-cyan-300" />}
            {syncing ? "Syncing…" : "Sync now"}
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
              syncMsg.includes("Synced") || syncMsg.includes("deleted")
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
