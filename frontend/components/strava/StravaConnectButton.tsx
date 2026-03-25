"use client";

import { useState } from "react";

import { deleteStravaDisconnect, getStravaConnect } from "@/lib/api";
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
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export type StravaConnectButtonProps = {
  userId: string | null;
  connected: boolean;
  athleteName: string | null;
  onConnected?: () => void | Promise<void>;
};

export function StravaConnectButton({
  userId,
  connected,
  athleteName,
  onConnected,
}: StravaConnectButtonProps) {
  const stravaOAuthConfigured = useAppStore((s) => s.stravaOAuthConfigured);
  const [loading, setLoading] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function connect() {
    if (!stravaOAuthConfigured) {
      setErr(
        "Strava OAuth is not configured on the API. Set STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, and STRAVA_REDIRECT_URI in backend/.env (see backend/.env.example), then restart the server."
      );
      return;
    }
    if (!userId) {
      setErr("Account is still syncing. Please wait a moment.");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const { auth_url } = await getStravaConnect();
      window.location.href = auth_url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start Strava OAuth");
      setLoading(false);
    }
  }

  async function disconnect() {
    if (!userId) return;
    setDisconnecting(true);
    setErr(null);
    try {
      await deleteStravaDisconnect();
      await onConnected?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  }

  if (connected) {
    return (
      <div className="flex w-full flex-col gap-3">
        <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" aria-hidden />
          <span>
            Connected as <strong className="font-medium">{athleteName ?? "Strava athlete"}</strong>
          </span>
        </div>
        <button
          type="button"
          onClick={() => void disconnect()}
          disabled={disconnecting || !userId}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
        >
          {disconnecting && <Spinner />}
          {disconnecting ? "Disconnecting…" : "Disconnect"}
        </button>
        {err && <p className="text-sm text-amber-300">{err}</p>}
      </div>
    );
  }

  const connectDisabled = loading || !userId;

  return (
    <div className="flex w-full flex-col items-stretch gap-2">
      {!stravaOAuthConfigured && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200/90">
          Strava OAuth is not configured on the server. Add{" "}
          <code className="rounded bg-zinc-800 px-1 text-xs">STRAVA_CLIENT_ID</code>,{" "}
          <code className="rounded bg-zinc-800 px-1 text-xs">STRAVA_CLIENT_SECRET</code>, and{" "}
          <code className="rounded bg-zinc-800 px-1 text-xs">STRAVA_REDIRECT_URI</code> to{" "}
          <code className="rounded bg-zinc-800 px-1 text-xs">backend/.env</code>, then restart the API.
        </p>
      )}
      <button
        type="button"
        onClick={() => void connect()}
        disabled={connectDisabled}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:brightness-110 disabled:opacity-50"
        style={{ backgroundColor: "#FC4C02" }}
      >
        {loading ? (
          <Spinner className="h-5 w-5 text-white" />
        ) : (
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-white/15 text-lg font-bold text-white"
            aria-hidden
          >
            S
          </span>
        )}
        {loading ? "Redirecting…" : "Connect with Strava"}
      </button>
      {err && <p className="text-center text-sm text-amber-300">{err}</p>}
    </div>
  );
}
