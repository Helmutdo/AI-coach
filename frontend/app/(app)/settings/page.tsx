"use client";

import { signOut, useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { GarminCSVUpload } from "@/components/garmin/GarminCSVUpload";
import { StravaConnectButton } from "@/components/strava/StravaConnectButton";
import {
  deleteUserData,
  getAIStatus,
  getStravaStatus,
  patchUserDisplayName,
  postStravaSync,
  uploadHRVCSV,
  uploadVO2maxCSV,
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
    stravaConnected,
    stravaAthleteName,
    aiConfigured,
    setStatusFromApi,
    setLastSync,
    userId,
    lastSync,
    displayName,
    setDisplayName,
  } = useAppStore();

  const [aiModel, setAiModel] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [deletingData, setDeletingData] = useState(false);
  const [stravaToast, setStravaToast] = useState<string | null>(null);
  const [stravaOAuthErr, setStravaOAuthErr] = useState<string | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);

  const [hrvUploading, setHrvUploading] = useState(false);
  const [hrvMsg, setHrvMsg] = useState<string | null>(null);
  const [vo2Uploading, setVo2Uploading] = useState(false);
  const [vo2Msg, setVo2Msg] = useState<string | null>(null);

  const refreshStatuses = useCallback(async () => {
    if (!userId) return;
    try {
      const [st, ai] = await Promise.all([
        getStravaStatus(),
        getAIStatus(),
      ]);
      setStatusFromApi({
        garminActive: false,
        stravaConnected: st.connected,
        stravaOAuthConfigured: st.oauth_configured ?? true,
        stravaAthleteName: st.athlete_name,
        aiConfigured: ai.configured,
        aiProvider: ai.model ?? null,
      });
      setAiModel(ai.model ?? null);
    } catch {
      setStatusFromApi({
        garminActive: false,
        stravaConnected: false,
        stravaAthleteName: null,
        aiConfigured: false,
        aiProvider: null,
      });
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

  async function syncStrava() {
    setSyncing(true);
    setSyncMsg(null);
    setStravaOAuthErr(null);
    try {
      const r = await postStravaSync({ days_back: 60 });
      const errNote = r.errors?.length > 0 ? ` (warnings: ${r.errors.length})` : "";
      setSyncMsg(`Strava: ${r.synced} new, ${r.updated} updated${errNote}.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Strava sync failed";
      setSyncMsg(`Strava: ${msg}`);
    }
    setLastSync(new Date());
    await refreshStatuses();
    setSyncing(false);
  }

  async function saveName() {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    setSavingName(true);
    setNameMsg(null);
    try {
      const res = await patchUserDisplayName(trimmed);
      setDisplayName(res.name);
      setEditingName(false);
      setNameMsg("Name updated.");
    } catch (e) {
      setNameMsg(e instanceof Error ? e.message : "Failed to save name.");
    } finally {
      setSavingName(false);
    }
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

  const name = displayName ?? session?.user?.name ?? "—";
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
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void saveName(); if (e.key === "Escape") setEditingName(false); }}
                    className="rounded-md border border-zinc-600 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => void saveName()}
                    disabled={savingName || !nameInput.trim()}
                    className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {savingName ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingName(false)}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="font-medium text-zinc-100">{name}</p>
                  <button
                    type="button"
                    onClick={() => { setNameInput(name === "—" ? "" : name); setEditingName(true); setNameMsg(null); }}
                    className="text-xs text-zinc-500 hover:text-zinc-300 underline-offset-2 hover:underline cursor-pointer"
                  >
                    Edit
                  </button>
                </div>
              )}
              <p className="text-sm text-zinc-500">{email}</p>
              {nameMsg && (
                <p className="mt-1 text-xs text-emerald-400">{nameMsg}</p>
              )}
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
          Upload Garmin CSV or connect Strava to sync activities.
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
            </div>
            <p className="mt-1 text-xs text-zinc-500">Upload CSV from Garmin Connect</p>
            <p className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/80">
              CSV export is only available on{" "}
              <a
                href="https://connect.garmin.com/modern/activities"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-amber-200"
              >
                Garmin Connect web
              </a>
              {" "}— not the mobile app. Go to Activities → export CSV.
            </p>
            <div className="mt-4 flex flex-1 flex-col">
              <GarminCSVUpload onUploaded={() => refreshStatuses()} />
            </div>
            <div className="mt-4 border-t border-zinc-800 pt-4 space-y-3">
              <p className="text-xs font-medium text-zinc-400">Wellness data (optional)</p>
              {/* HRV CSV */}
              <div className="flex items-center gap-3">
                <label className="flex-1 text-xs text-zinc-400">
                  HRV status CSV{" "}
                  <span className="text-zinc-600">(Estado de VFC.csv)</span>
                </label>
                <label className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors">
                  {hrvUploading ? <Spinner className="h-3 w-3" /> : "Upload"}
                  <input
                    type="file"
                    accept=".csv"
                    className="hidden"
                    disabled={hrvUploading}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      setHrvUploading(true);
                      setHrvMsg(null);
                      try {
                        const r = await uploadHRVCSV(f);
                        setHrvMsg(`✓ ${r.updated} updated, ${r.inserted} inserted`);
                      } catch {
                        setHrvMsg("Upload failed");
                      } finally {
                        setHrvUploading(false);
                        e.target.value = "";
                      }
                    }}
                  />
                </label>
              </div>
              {hrvMsg && <p className="text-xs text-zinc-400">{hrvMsg}</p>}
              {/* VO2max CSV */}
              <div className="flex items-center gap-3">
                <label className="flex-1 text-xs text-zinc-400">
                  VO2max CSV{" "}
                  <span className="text-zinc-600">(Consumo máximo de oxígeno.csv)</span>
                </label>
                <label className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors">
                  {vo2Uploading ? <Spinner className="h-3 w-3" /> : "Upload"}
                  <input
                    type="file"
                    accept=".csv"
                    className="hidden"
                    disabled={vo2Uploading}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      setVo2Uploading(true);
                      setVo2Msg(null);
                      try {
                        const r = await uploadVO2maxCSV(f);
                        setVo2Msg(`✓ VO2max saved: ${r.vo2max} ml/kg/min`);
                      } catch {
                        setVo2Msg("Upload failed — complete your athlete profile first");
                      } finally {
                        setVo2Uploading(false);
                        e.target.value = "";
                      }
                    }}
                  />
                </label>
              </div>
              {vo2Msg && <p className="text-xs text-zinc-400">{vo2Msg}</p>}
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
            <p className="mt-3 text-xs text-zinc-600">Compatible with Strava</p>
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
            onClick={() => void syncStrava()}
            disabled={syncing || !userId}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {syncing && <Spinner className="h-4 w-4 text-cyan-300" />}
            {syncing ? "Syncing…" : "Sync Strava"}
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
