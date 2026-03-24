"use client";

import { useState } from "react";

import { postGarminLogin } from "@/lib/api";

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className ?? "h-5 w-5"}`}
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

export type GarminLoginCardProps = {
  userId: string | null;
  /** After successful login + optional success UI */
  onConnected?: () => void | Promise<void>;
  /** Show checkmark + “Connected!” before calling onConnected (onboarding). */
  showSuccessAnimation?: boolean;
};

export function GarminLoginCard({
  userId,
  onConnected,
  showSuccessAnimation = false,
}: GarminLoginCardProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function connect() {
    if (!userId) {
      setErr("Account is still syncing. Please wait a moment.");
      return;
    }
    setLoading(true);
    setErr(null);
    setOk(false);
    try {
      await postGarminLogin(
        email || password ? { email: email || undefined, password: password || undefined } : {}
      );
      setPassword("");
      if (showSuccessAnimation) {
        setOk(true);
      }
      await onConnected?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Connection failed");
      setOk(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/80 p-8 shadow-2xl shadow-black/40">
      <div className="flex flex-col items-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-xl font-bold text-white">
          G
        </div>
        <p className="mt-1 text-xs font-medium text-zinc-500">Garmin</p>
      </div>
      <h2 className="mt-4 text-center text-xl font-semibold text-zinc-100">
        Connect your Garmin account
      </h2>
      <p className="mt-2 text-center text-sm text-zinc-400">
        We&apos;ll use your Garmin Connect credentials to sync your training data
      </p>

      <div className="mt-6 space-y-4">
        <div>
          <label className="text-xs font-medium text-zinc-500">Garmin email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            autoComplete="username"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-zinc-500">Garmin password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            autoComplete="current-password"
          />
        </div>
        <p className="text-xs text-zinc-500">
          Your password is only used to generate a secure token. It is never stored.
        </p>
      </div>

      {err && <p className="mt-3 text-sm text-red-400">{err}</p>}

      {ok && showSuccessAnimation ? (
        <div className="mt-6 flex flex-col items-center gap-2 text-emerald-400">
          <span className="text-3xl motion-safe:animate-bounce">✓</span>
          <span className="font-medium">Connected!</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void connect()}
          disabled={loading || !userId}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#007CC3] py-3 text-sm font-semibold text-white hover:bg-[#006aa8] disabled:opacity-50"
        >
          {loading && <Spinner className="h-5 w-5 text-white" />}
          {loading ? "Connecting…" : "Connect Garmin"}
        </button>
      )}

      <div className="mt-6 text-center">
        <span className="group relative inline-block cursor-help text-xs text-zinc-500 underline decoration-dotted">
          What is this?
          <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-64 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-left text-[11px] leading-snug text-zinc-300 opacity-0 shadow-lg transition group-hover:opacity-100">
            Garmin uses OAuth tokens saved on the server after you sign in. Your password is not
            stored; only encrypted session tokens are kept to sync your activities.
          </span>
        </span>
      </div>
    </div>
  );
}
