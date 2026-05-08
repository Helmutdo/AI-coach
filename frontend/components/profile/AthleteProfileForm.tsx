"use client";

import { type AthleteProfileData } from "@/lib/api";

type Props = {
  value: Partial<AthleteProfileData>;
  onChange: (updated: Partial<AthleteProfileData>) => void;
  step: 1 | 2 | 3 | 4;
};

function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T | null | undefined;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
            value === o.value
              ? "border-emerald-500 bg-emerald-500/15 text-emerald-400"
              : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-zinc-300">{label}</label>
      {children}
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  placeholder,
  min,
  max,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  placeholder?: string;
  min?: number;
  max?: number;
}) {
  return (
    <input
      type="number"
      value={value ?? ""}
      onChange={(e) => {
        const n = parseFloat(e.target.value);
        onChange(isNaN(n) ? null : n);
      }}
      placeholder={placeholder}
      min={min}
      max={max}
      className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
    />
  );
}

export function AthleteProfileForm({ value, onChange, step }: Props) {
  const set = <K extends keyof AthleteProfileData>(k: K, v: AthleteProfileData[K]) =>
    onChange({ ...value, [k]: v });

  if (step === 1) {
    return (
      <div className="flex flex-col gap-6">
        <Field label="Sex">
          <ToggleGroup
            options={[
              { label: "Male", value: "male" },
              { label: "Female", value: "female" },
              { label: "Other", value: "other" },
            ]}
            value={value.sex}
            onChange={(v) => set("sex", v)}
          />
        </Field>
        <Field label="Birth year">
          <NumberInput
            value={value.birth_year}
            onChange={(v) => set("birth_year", v ?? 1990)}
            placeholder="e.g. 1990"
            min={1940}
            max={2010}
          />
        </Field>
        <Field label="Weight (kg)">
          <NumberInput
            value={value.weight_kg}
            onChange={(v) => set("weight_kg", v ?? 0)}
            placeholder="e.g. 72"
            min={30}
            max={250}
          />
        </Field>
        <Field label="Height (cm)">
          <NumberInput
            value={value.height_cm}
            onChange={(v) => set("height_cm", v ?? 0)}
            placeholder="e.g. 178"
            min={100}
            max={250}
          />
        </Field>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="flex flex-col gap-6">
        <Field label="Injuries or medical conditions">
          <textarea
            value={value.injuries ?? ""}
            onChange={(e) => set("injuries", e.target.value)}
            placeholder='e.g. "mild right knee tendinitis, mild asthma". Write "none" if none.'
            rows={4}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
          />
        </Field>
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="flex flex-col gap-6">
        <Field label="Weekly training hours">
          <NumberInput
            value={value.hours_per_week}
            onChange={(v) => set("hours_per_week", v)}
            placeholder="e.g. 10"
            min={1}
            max={40}
          />
        </Field>
        <Field label="Experience level">
          <ToggleGroup
            options={[
              { label: "Beginner", value: "beginner" },
              { label: "Amateur", value: "amateur" },
              { label: "Competitive", value: "competitive" },
            ]}
            value={value.experience}
            onChange={(v) => set("experience", v)}
          />
        </Field>
        <Field label="Years in triathlon">
          <NumberInput
            value={value.years_in_triathlon}
            onChange={(v) => set("years_in_triathlon", v)}
            placeholder="e.g. 5"
            min={0}
            max={50}
          />
        </Field>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Field label="Target distance">
        <ToggleGroup
          options={[
            { label: "Sprint", value: "sprint" },
            { label: "Olympic", value: "olympic" },
            { label: "70.3", value: "70.3" },
            { label: "Ironman", value: "ironman" },
          ]}
          value={value.target_distance}
          onChange={(v) => set("target_distance", v)}
        />
      </Field>
      <Field label="Primary goal">
        <ToggleGroup
          options={[
            { label: "Finish strong", value: "finish" },
            { label: "Time goal", value: "time_goal" },
            { label: "General fitness", value: "fitness" },
            { label: "Weight management", value: "weight" },
          ]}
          value={value.primary_goal}
          onChange={(v) => set("primary_goal", v)}
        />
      </Field>
      <Field label="Next race (optional)">
        <input
          type="text"
          value={value.next_race_date ?? ""}
          onChange={(e) => set("next_race_date", e.target.value || null)}
          placeholder='e.g. "September 2026" or "TBD"'
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
        />
      </Field>
    </div>
  );
}