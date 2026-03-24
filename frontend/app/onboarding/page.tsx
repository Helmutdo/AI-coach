"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

import { AIProviderCard } from "@/components/ai/AIProviderCard";
import { GarminLoginCard } from "@/components/garmin/GarminLoginCard";
import { getAIStatus, getGarminStatus } from "@/lib/api";
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

export default function OnboardingPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const userId = useAppStore((s) => s.userId);
  const setStatusFromApi = useAppStore((s) => s.setStatusFromApi);

  const [step, setStep] = useState(1);
  const [garminOk, setGarminOk] = useState(false);

  const displayName = session?.user?.name || session?.user?.email || "there";
  const avatar = session?.user?.image;

  const refreshStatus = useCallback(async () => {
    if (!userId) return;
    try {
      const [g, ai] = await Promise.all([getGarminStatus(), getAIStatus()]);
      setStatusFromApi({
        garminActive: g.active,
        aiConfigured: ai.configured,
        aiProvider: ai.provider ?? null,
      });
    } catch {
      /* ignore */
    }
  }, [userId, setStatusFromApi]);

  useEffect(() => {
    if (garminOk) {
      const t = setTimeout(() => setStep(3), 1500);
      return () => clearTimeout(t);
    }
  }, [garminOk]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <Spinner className="h-8 w-8 text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <div className="mx-auto max-w-lg">
        <div className="mb-8 flex items-center justify-center gap-2 text-sm text-zinc-500">
          {[1, 2, 3].map((s) => (
            <span key={s} className="flex items-center gap-2">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                  step === s
                    ? "bg-emerald-600 text-white"
                    : step > s
                      ? "bg-emerald-600/30 text-emerald-300"
                      : "bg-zinc-800 text-zinc-500"
                }`}
              >
                {s}
              </span>
              {s < 3 && <span className="text-zinc-600">—</span>}
            </span>
          ))}
        </div>
        <p className="mb-2 text-center text-xs uppercase tracking-wider text-zinc-500">
          Step {step} of 3
        </p>

        {step === 1 && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Welcome, {displayName}</h1>
            <div className="mx-auto mt-6 flex justify-center">
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatar}
                  alt=""
                  width={96}
                  height={96}
                  className="h-24 w-24 rounded-full border-2 border-zinc-700 object-cover"
                />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-zinc-800 text-2xl text-zinc-500">
                  ?
                </div>
              )}
            </div>
            <p className="mt-6 text-zinc-400">
              Connect your Garmin and choose your AI coach to get started
            </p>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="mt-8 w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500"
            >
              Get started →
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="flex min-h-[60vh] flex-col items-center justify-center">
            <GarminLoginCard
              userId={userId}
              showSuccessAnimation
              onConnected={async () => {
                await refreshStatus();
                setGarminOk(true);
              }}
            />
          </div>
        )}

        {step === 3 && (
          <AIProviderCard
            userId={userId}
            submitLabel="Start coaching →"
            onSaved={async () => {
              await refreshStatus();
              router.push("/dashboard");
              router.refresh();
            }}
          />
        )}
      </div>
    </div>
  );
}
