"use client";

import Image from "next/image";
import { signIn } from "next-auth/react";

function GoogleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden>
      <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

const FEATURES = [
  { icon: "🤖", text: "Chat with AI that knows your full training history" },
  { icon: "📂", text: "Import from Garmin CSV or connect Strava" },
  { icon: "📊", text: "Performance Management Chart (CTL / ATL / TSB)" },
  { icon: "❤️", text: "HRV, sleep score, and recovery metrics" },
];

export function LandingSignIn() {
  return (
    <div className="flex min-h-screen bg-zinc-950">
      {/* Left column */}
      <div className="flex flex-1 flex-col items-center justify-center px-8 py-12 lg:items-start lg:px-16">
        <div className="w-full max-w-md">
          <h1 className="text-4xl font-bold tracking-tight text-zinc-50 sm:text-5xl">
            AI Coach
          </h1>
          <p className="mt-4 text-lg text-zinc-400">
            AI-powered endurance coaching for triathletes. Understands your training history, recovery, and readiness.
          </p>

          <ul className="mt-8 space-y-3">
            {FEATURES.map(({ icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-zinc-300">
                <span className="text-base">{icon}</span>
                {text}
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => void signIn("google", { callbackUrl: "/" })}
            className="mt-10 inline-flex w-full items-center justify-center gap-3 rounded-lg bg-[#4285F4] px-6 py-3.5 text-sm font-semibold text-white shadow-lg transition hover:bg-[#3367d6] focus:outline-none focus:ring-2 focus:ring-[#4285F4] focus:ring-offset-2 focus:ring-offset-zinc-950"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <p className="mt-6 text-xs text-zinc-500">
            Your data stays private and is never shared.
          </p>
        </div>
      </div>

      {/* Right column — screenshot (hidden on small screens) */}
      <div className="hidden lg:flex flex-1 items-center justify-center bg-zinc-900/50 p-8">
        <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-800 shadow-2xl shadow-black/60">
          <Image
            src="/dashboard-preview.jpeg"
            alt="AI Coach dashboard showing training analytics"
            width={800}
            height={520}
            className="w-full object-cover"
            priority
          />
        </div>
      </div>
    </div>
  );
}
