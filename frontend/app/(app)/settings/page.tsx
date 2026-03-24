"use client";

import { useEffect, useState } from "react";
import {
  getAIStatus,
  getGarminStatus,
  postAIConfigure,
  postGarminLogin,
  postGarminSync,
} from "@/lib/api";
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

export default function SettingsPage() {
  const {
    garminConnected,
    aiConfigured,
    setGarminConnected,
    setAiConfigured,
    setLastSync,
  } = useAppStore();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const [connectSuccess, setConnectSuccess] = useState(false);

  const [provider, setProvider] = useState<"anthropic" | "openai" | "google">(
    "anthropic"
  );
  const [apiKey, setApiKey] = useState("");
  const [savingAi, setSavingAi] = useState(false);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [aiSuccess, setAiSuccess] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, ai] = await Promise.all([getGarminStatus(), getAIStatus()]);
        setGarminConnected(s.active);
        setAiConfigured(ai.configured);
      } catch {
        setGarminConnected(false);
      }
    })();
  }, [setGarminConnected, setAiConfigured]);

  async function connectGarmin() {
    setConnecting(true);
    setConnectMsg(null);
    setConnectSuccess(false);
    try {
      await postGarminLogin(
        email || password
          ? { email: email || undefined, password: password || undefined }
          : {}
      );
      setGarminConnected(true);
      setConnectSuccess(true);
      setConnectMsg(null);
      setPassword("");
    } catch (e) {
      setConnectMsg(e instanceof Error ? e.message : "Login failed");
      setGarminConnected(false);
      setConnectSuccess(false);
    } finally {
      setConnecting(false);
    }
  }

  async function saveAi() {
    setSavingAi(true);
    setAiMsg(null);
    setAiSuccess(false);
    try {
      await postAIConfigure({ provider, api_key: apiKey });
      setAiConfigured(true);
      setAiSuccess(true);
      setApiKey("");
    } catch (e) {
      setAiMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingAi(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await postGarminSync();
      setLastSync(new Date());
      setGarminConnected(true);
      const line = `Synced ${r.synced_activities} activities and ${r.synced_days} days of metrics.`;
      const warn =
        r.errors?.length && r.partial
          ? ` ${r.errors.join(" ")}`
          : "";
      setSyncMsg(line + warn);
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500">Garmin account, AI provider, and data sync.</p>
      </div>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
        <h2 className="text-lg font-medium text-zinc-200">Garmin</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Leave email/password empty to use values from <code className="text-zinc-400">.env</code>.
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-zinc-500">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              placeholder="Optional override"
              autoComplete="username"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-500">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              placeholder="Optional override"
              autoComplete="current-password"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void connectGarmin()}
              disabled={connecting}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {connecting && <Spinner className="h-4 w-4 text-white" />}
              {connecting ? "Connecting…" : "Connect Garmin"}
            </button>
            {garminConnected && connectSuccess && (
              <span className="inline-flex items-center rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-400">
                Connected
              </span>
            )}
            {garminConnected && !connectSuccess && (
              <span className="inline-flex items-center rounded-full bg-zinc-700/50 px-2.5 py-1 text-xs font-medium text-zinc-400">
                Session active
              </span>
            )}
            {!garminConnected && (
              <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-400">
                Not connected
              </span>
            )}
          </div>
          {connectMsg && <p className="text-sm text-red-400">{connectMsg}</p>}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
        <h2 className="text-lg font-medium text-zinc-200">AI provider</h2>
        <p className="mt-1 text-sm text-zinc-500">Keys are stored in the backend database.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setProvider("anthropic")}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              provider === "anthropic"
                ? "bg-emerald-600 text-white"
                : "border border-zinc-700 bg-zinc-950 text-zinc-300"
            }`}
          >
            Claude (Anthropic)
          </button>
          <button
            type="button"
            onClick={() => setProvider("openai")}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              provider === "openai"
                ? "bg-emerald-600 text-white"
                : "border border-zinc-700 bg-zinc-950 text-zinc-300"
            }`}
          >
            ChatGPT (OpenAI)
          </button>
          <button
            type="button"
            onClick={() => setProvider("google")}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              provider === "google"
                ? "bg-emerald-600 text-white"
                : "border border-zinc-700 bg-zinc-950 text-zinc-300"
            }`}
          >
            Gemini (Google AI Studio)
          </button>
        </div>
        <div className="mt-4">
          <label className="text-xs font-medium text-zinc-500">API key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            placeholder={
              provider === "google"
                ? "Google AI Studio key (AIza…)"
                : "sk-…"
            }
            autoComplete="off"
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void saveAi()}
            disabled={savingAi || !apiKey.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
          >
            {savingAi && <Spinner className="h-4 w-4 text-zinc-900" />}
            {savingAi ? "Saving…" : "Save"}
          </button>
          {aiSuccess && (
            <span className="inline-flex items-center rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-400">
              API key saved
            </span>
          )}
        </div>
        {aiMsg && <p className="mt-2 text-sm text-red-400">{aiMsg}</p>}
        {aiConfigured && !aiSuccess && (
          <p className="mt-2 text-xs text-zinc-500">AI is configured on the server.</p>
        )}
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
        <h2 className="text-lg font-medium text-zinc-200">Sync</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Pull latest activities and daily metrics into the local database.
        </p>
        <button
          type="button"
          onClick={() => void syncNow()}
          disabled={syncing}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {syncing && <Spinner className="h-4 w-4 text-cyan-300" />}
          {syncing ? "Syncing…" : "Sync now"}
        </button>
        {syncMsg && (
          <p
            className={`mt-3 text-sm ${
              syncMsg.includes("Synced") ? "text-emerald-400/90" : "text-amber-200"
            }`}
          >
            {syncMsg}
          </p>
        )}
      </section>
    </div>
  );
}
