"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useState } from "react";

import { AIProviderCard } from "@/components/ai/AIProviderCard";
import { GarminLoginCard } from "@/components/garmin/GarminLoginCard";
import { StravaConnectButton } from "@/components/strava/StravaConnectButton";
import { getAIStatus, getGarminStatus, getStravaStatus } from "@/lib/api";
import { useAppStore } from "@/store/appStore";

type FitnessProviderStep = "choice" | "garmin" | "strava";

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
  const garminConnected = useAppStore((s) => s.garminConnected);
  const stravaConnected = useAppStore((s) => s.stravaConnected);
  const stravaAthleteName = useAppStore((s) => s.stravaAthleteName);
  const setStatusFromApi = useAppStore((s) => s.setStatusFromApi);
  const setGarminConnected = useAppStore((s) => s.setGarminConnected);
  const setAiConfigured = useAppStore((s) => s.setAiConfigured);

  const [step, setStep] = useState(1);
  const [fitnessProvider, setFitnessProvider] = useState<FitnessProviderStep>("choice");

  const displayName = session?.user?.name || session?.user?.email || "there";
  const avatar = session?.user?.image;

  const anyFitnessConnected = garminConnected || stravaConnected;

  const refreshStatus = useCallback(async () => {
    if (!userId) return;
    try {
      const [g, st, ai] = await Promise.all([
        getGarminStatus(),
        getStravaStatus(),
        getAIStatus(),
      ]);
      setStatusFromApi({
        garminActive: g.active,
        stravaConnected: st.connected,
        stravaOAuthConfigured: st.oauth_configured ?? true,
        stravaAthleteName: st.athlete_name,
        aiConfigured: ai.configured,
        aiProvider: ai.provider ?? null,
      });
    } catch {
      /* ignore */
    }
  }, [userId, setStatusFromApi]);

  function handleSkipFitness() {
    try {
      localStorage.setItem("onboarding_skipped_garmin", "true");
    } catch { /* ignore */ }
    setGarminConnected(false);
    setStep(3);
  }

  function handleSkipAI() {
    try {
      localStorage.setItem("onboarding_skipped_ai", "true");
    } catch { /* ignore */ }
    setAiConfigured(false);
    router.push("/dashboard");
  }

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <Spinner className="h-8 w-8 text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <div
        className={`mx-auto ${step === 2 && fitnessProvider !== "choice" ? "max-w-5xl" : "max-w-lg"}`}
      >
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
              Connect your fitness data and choose your AI coach to get started
            </p>
            <button
              type="button"
              onClick={() => {
                setFitnessProvider("choice");
                setStep(2);
              }}
              className="mt-8 w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500"
            >
              Get started →
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <h1 className="text-center text-2xl font-semibold tracking-tight">
              Connect your fitness data
            </h1>

            {fitnessProvider === "choice" && (
              <>
                <p className="text-center text-zinc-400">
                  Choose whether you want to use Garmin Connect or Strava to sync your activities.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setFitnessProvider("garmin")}
                    className="flex flex-col items-start rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 text-left transition hover:border-emerald-600/50 hover:bg-zinc-900"
                  >
                    <span className="text-lg font-semibold text-zinc-100">Use Garmin</span>
                    <span className="mt-1 text-sm text-zinc-500">Garmin Connect — sign in with your account</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFitnessProvider("strava")}
                    className="flex flex-col items-start rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 text-left transition hover:border-emerald-600/50 hover:bg-zinc-900"
                  >
                    <span className="text-lg font-semibold text-zinc-100">Use Strava</span>
                    <span className="mt-1 text-sm text-zinc-500">Strava — connect with OAuth (no app password)</span>
                  </button>
                </div>
                <div className="text-center">
                  <button
                    type="button"
                    onClick={handleSkipFitness}
                    className="text-sm text-gray-400 hover:text-gray-300"
                  >
                    Skip for now →
                  </button>
                </div>
              </>
            )}

            {fitnessProvider === "garmin" && (
              <div className="mx-auto max-w-xl space-y-4">
                <button
                  type="button"
                  onClick={() => setFitnessProvider("choice")}
                  className="text-sm text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
                >
                  ← Choose Garmin or Strava
                </button>
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
                  <h2 className="text-lg font-semibold text-zinc-100">Garmin Connect</h2>
                  <p className="mt-1 text-sm text-zinc-500">Direct sync via credentials</p>
                  <div className="mt-4 min-h-[280px]">
                    <GarminLoginCard
                      userId={userId}
                      showSuccessAnimation
                      onConnected={async () => {
                        await refreshStatus();
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {fitnessProvider === "strava" && (
              <div className="mx-auto max-w-xl space-y-4">
                <button
                  type="button"
                  onClick={() => setFitnessProvider("choice")}
                  className="text-sm text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
                >
                  ← Choose Garmin or Strava
                </button>
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
                  <h2 className="text-lg font-semibold text-zinc-100">Strava</h2>
                  <p className="mt-1 text-sm text-zinc-500">OAuth — no password needed</p>
                  <div className="mt-6 flex min-h-[280px] flex-col justify-center">
                    <StravaConnectButton
                      userId={userId}
                      connected={stravaConnected}
                      athleteName={stravaAthleteName}
                      onConnected={async () => {
                        await refreshStatus();
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {fitnessProvider !== "choice" && (
              <>
                <p className="text-center text-sm text-zinc-500">
                  You can connect the other source later in Settings if you need both.
                </p>
                <div className="flex flex-col items-center gap-3">
                  <button
                    type="button"
                    disabled={!anyFitnessConnected}
                    onClick={() => setStep(3)}
                    className="rounded-xl bg-emerald-600 px-8 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next →
                  </button>
                  <button
                    type="button"
                    onClick={handleSkipFitness}
                    className="text-sm text-gray-400 hover:text-gray-300"
                  >
                    Skip for now →
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <AIProviderCard
              userId={userId}
              submitLabel="Start coaching →"
              onSaved={async () => {
                await refreshStatus();
                router.push("/dashboard");
                router.refresh();
              }}
            />
            <div className="text-center">
              <button
                type="button"
                onClick={handleSkipAI}
                className="text-sm text-gray-400 hover:text-gray-300"
              >
                Skip — I'll configure this later
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
