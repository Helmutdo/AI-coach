"use client";

import { useState } from "react";
import { type AthleteProfileData, saveProfile } from "@/lib/api";
import { AthleteProfileForm } from "./AthleteProfileForm";

type Props = {
  onComplete: () => void;
};

const STEPS = [
  { title: "Your basics", subtitle: "Physical stats for training load calculations", required: true },
  { title: "Health & injuries", subtitle: "So your coach can give safe recommendations", required: true },
  { title: "Training load", subtitle: "Helps calibrate volume and intensity", required: false },
  { title: "Your goals", subtitle: "Focus your coaching plan", required: false },
] as const;

export function AthleteProfileWizard({ onComplete }: Props) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [profile, setProfile] = useState<Partial<AthleteProfileData>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = STEPS[step - 1];

  const step1Valid =
    !!profile.sex &&
    !!profile.birth_year &&
    profile.birth_year >= 1940 &&
    profile.birth_year <= 2010 &&
    !!profile.weight_kg &&
    profile.weight_kg > 0 &&
    !!profile.height_cm &&
    profile.height_cm > 0;

  const step2Valid = !!profile.injuries && profile.injuries.trim().length > 0;

  const canNext =
    (step === 1 && step1Valid) ||
    (step === 2 && step2Valid) ||
    step === 3 ||
    step === 4;

  async function handleFinish() {
    setSaving(true);
    setError(null);
    try {
      await saveProfile(profile as AthleteProfileData);
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save profile");
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Progress */}
      <div className="flex gap-1.5">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i < step ? "bg-emerald-500" : i === step - 1 ? "bg-emerald-500/60" : "bg-zinc-800"
            }`}
          />
        ))}
      </div>

      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-zinc-100">{current.title}</h2>
          {!current.required && (
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500">
              optional
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-zinc-500">{current.subtitle}</p>
      </div>

      {/* Form */}
      <AthleteProfileForm value={profile} onChange={setProfile} step={step} />

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        {step > 1 ? (
          <button
            type="button"
            onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3 | 4)}
            className="text-sm text-zinc-500 hover:text-zinc-300"
          >
            ← Back
          </button>
        ) : (
          <div />
        )}
        <div className="flex gap-3">
          {!current.required && step < 4 && (
            <button
              type="button"
              onClick={() => setStep((s) => (s + 1) as 2 | 3 | 4)}
              className="text-sm text-zinc-500 hover:text-zinc-300"
            >
              Skip →
            </button>
          )}
          {!current.required && step === 4 && (
            <button
              type="button"
              onClick={handleFinish}
              disabled={saving}
              className="text-sm text-zinc-500 hover:text-zinc-300"
            >
              Skip →
            </button>
          )}
          {step < 4 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s + 1) as 2 | 3 | 4)}
              disabled={!canNext}
              className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-40"
            >
              Next →
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              disabled={saving}
              className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Finish →"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
