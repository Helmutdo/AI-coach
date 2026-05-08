"use client";

import { useEffect, useState } from "react";
import { type AthleteProfileData, getProfile, saveProfile } from "@/lib/api";
import { AthleteProfileForm } from "@/components/profile/AthleteProfileForm";

const STEPS = [1, 2, 3, 4] as const;
const STEP_LABELS = ["Basics", "Health", "Training", "Goals"];

export default function ProfilePage() {
  const [profile, setProfile] = useState<Partial<AthleteProfileData>>({});
  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4>(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProfile().then((p) => {
      if (p) setProfile(p);
      setLoading(false);
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveProfile(profile as AthleteProfileData);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-zinc-500">
        Loading profile…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl py-8">
      <h1 className="text-2xl font-semibold text-zinc-100">Athlete Profile</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Your AI Coach uses this to personalize every recommendation.
      </p>

      {/* Step tabs */}
      <div className="mt-6 flex gap-1 rounded-xl bg-zinc-900 p-1">
        {STEPS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setActiveStep(s)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
              activeStep === s
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {STEP_LABELS[s - 1]}
          </button>
        ))}
      </div>

      {/* Form */}
      <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <AthleteProfileForm value={profile} onChange={setProfile} step={activeStep} />
      </div>

      {/* Save */}
      <div className="mt-4 flex items-center gap-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save profile"}
        </button>
        {saved && <span className="text-sm text-emerald-400">Saved ✓</span>}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
    </div>
  );
}
