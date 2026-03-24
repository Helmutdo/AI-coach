"use client";

import { useEffect, useState } from "react";

import { postAIConfigure } from "@/lib/api";
import { AI_KEY_LINKS, AI_PROVIDERS, type AIProviderId } from "@/lib/aiProviders";

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

export type AIProviderCardProps = {
  userId: string | null;
  /** Initial selected provider (e.g. from GET /api/auth/ai/status) */
  initialProvider?: AIProviderId;
  submitLabel?: string;
  showFourthSlot?: boolean;
  onSaved?: () => void | Promise<void>;
};

export function AIProviderCard({
  userId,
  initialProvider = "anthropic",
  submitLabel = "Save",
  showFourthSlot = true,
  onSaved,
}: AIProviderCardProps) {
  const [provider, setProvider] = useState<AIProviderId>(initialProvider);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setProvider(initialProvider);
    setApiKey("");
    setErr(null);
  }, [initialProvider]);

  async function save() {
    if (!userId || !apiKey.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      await postAIConfigure({ provider, api_key: apiKey.trim() });
      setApiKey("");
      await onSaved?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
      <h3 className="text-center text-lg font-semibold text-zinc-100">Choose your AI coach</h3>
      <p className="mt-1 text-center text-sm text-zinc-500">Pick a provider and add your API key</p>

      <div className="mt-6 grid grid-cols-2 gap-3">
        {AI_PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setProvider(p.id);
              setApiKey("");
              setErr(null);
            }}
            className={`rounded-xl border p-4 text-left transition ${
              provider === p.id
                ? "border-emerald-500/60 bg-emerald-500/10"
                : "border-zinc-800 bg-zinc-950/50 hover:border-zinc-700"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${p.dot}`} />
              <span className="text-sm font-semibold text-zinc-100">{p.title}</span>
            </div>
            <p className="mt-2 text-xs text-zinc-500">{p.desc}</p>
          </button>
        ))}
        {showFourthSlot && (
          <div className="flex flex-col justify-center rounded-xl border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-600">
            More coming soon
          </div>
        )}
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
        <label className="text-xs font-medium text-zinc-500">
          Your {AI_PROVIDERS.find((x) => x.id === provider)?.title ?? "provider"} API key
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={AI_KEY_LINKS[provider].placeholder}
          className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          autoComplete="off"
        />
        <a
          href={AI_KEY_LINKS[provider].href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-xs text-emerald-500 hover:underline"
        >
          {AI_KEY_LINKS[provider].label}
        </a>
      </div>

      {err && <p className="mt-3 text-sm text-red-400">{err}</p>}

      <button
        type="button"
        onClick={() => void save()}
        disabled={loading || !apiKey.trim() || !userId}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {loading && <Spinner className="h-5 w-5 text-white" />}
        {loading ? "Saving…" : submitLabel}
      </button>
    </div>
  );
}
