"use client";

import { useRef, useState } from "react";

import { getGarminStatus, uploadGarminCSV } from "@/lib/api";
import { useAppStore } from "@/store/appStore";

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

export type GarminCSVUploadProps = {
  onUploaded?: () => void | Promise<void>;
};

export function GarminCSVUpload({ onUploaded }: GarminCSVUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    inserted: number;
    skipped: number;
    errors: string[];
    skip_reasons?: { already_imported: number; api_duplicate: number; bad_date: number; empty_row: number };
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleFile(file: File) {
    setLoading(true);
    setErr(null);
    setResult(null);
    try {
      const res = await uploadGarminCSV(file);
      setResult({ inserted: res.inserted, skipped: res.skipped, errors: res.errors ?? [], skip_reasons: res.skip_reasons });

      // Clear any stored "skipped garmin" flags so dashboard banner disappears
      if (typeof window !== "undefined") {
        localStorage.removeItem("onboarding_skipped_garmin");
        localStorage.removeItem("banner_dismissed_garmin");
      }

      // Refresh hasGarminData in store immediately
      try {
        const status = await getGarminStatus();
        useAppStore.getState().setStatusFromApi({
          garminActive: status.active,
          garminHasData: status.has_data,
          stravaConnected: useAppStore.getState().stravaConnected,
          stravaAthleteName: useAppStore.getState().stravaAthleteName,
          aiConfigured: useAppStore.getState().aiConfigured,
          aiProvider: useAppStore.getState().aiProvider,
        });
      } catch {
        // Non-critical — store will update on next navigation
      }

      await onUploaded?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500">
        Export from{" "}
        <span className="text-zinc-400">Garmin Connect → Activities → Export CSV</span>, then
        upload here.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={onChange}
        disabled={loading}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="inline-flex w-fit items-center gap-2 rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
      >
        {loading && <Spinner className="h-4 w-4 text-zinc-300" />}
        {loading ? "Uploading…" : "Upload CSV"}
      </button>

      {result && (
        <div className="space-y-1">
          <p className={`text-sm ${result.inserted > 0 ? "text-emerald-400" : "text-zinc-400"}`}>
            {result.inserted} activities imported, {result.skipped} skipped.
          </p>
          {result.skipped > 0 && result.skip_reasons && (
            <ul className="text-xs text-zinc-500 space-y-0.5 pl-2">
              {result.skip_reasons.already_imported > 0 && (
                <li>· {result.skip_reasons.already_imported} already imported (duplicates)</li>
              )}
              {result.skip_reasons.api_duplicate > 0 && (
                <li>· {result.skip_reasons.api_duplicate} matched Garmin API activity</li>
              )}
              {result.skip_reasons.bad_date > 0 && (
                <li>· {result.skip_reasons.bad_date} bad date format</li>
              )}
              {result.skip_reasons.empty_row > 0 && (
                <li>· {result.skip_reasons.empty_row} empty rows</li>
              )}
            </ul>
          )}
          {result.errors.length > 0 && (
            <ul className="text-xs text-amber-400 space-y-0.5 pl-2">
              {result.errors.slice(0, 5).map((e, i) => <li key={i}>· {e}</li>)}
            </ul>
          )}
        </div>
      )}
      {err && <p className="text-sm text-red-400">{err}</p>}
    </div>
  );
}
