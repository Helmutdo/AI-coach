import { create } from "zustand";

export type AppStore = {
  garminConnected: boolean;
  stravaConnected: boolean;
  /** From GET /api/strava/status — false if server env lacks Strava OAuth vars */
  stravaOAuthConfigured: boolean;
  stravaAthleteName: string | null;
  aiConfigured: boolean;
  /** True when (Garmin or Strava) and AI key are configured (from API). */
  onboardingComplete: boolean;
  aiProvider: string | null;
  lastSync: Date | null;
  /** Backend User.id (UUID) after POST /api/users/me or session */
  userId: string | null;
  setGarminConnected: (v: boolean) => void;
  setAiConfigured: (v: boolean) => void;
  setOnboardingComplete: (v: boolean) => void;
  setAiProvider: (v: string | null) => void;
  setLastSync: (d: Date | null) => void;
  setUserId: (id: string | null) => void;
  /** Sync flags from GET /api/auth/garmin/status + GET /api/strava/status + GET /api/auth/ai/status */
  setStatusFromApi: (g: {
    garminActive: boolean;
    stravaConnected: boolean;
    stravaOAuthConfigured?: boolean;
    stravaAthleteName: string | null;
    aiConfigured: boolean;
    aiProvider: string | null;
  }) => void;
};

function hasFitnessSource(g: { garminConnected: boolean; stravaConnected: boolean }) {
  return g.garminConnected || g.stravaConnected;
}

export const useAppStore = create<AppStore>((set, get) => ({
  garminConnected: false,
  stravaConnected: false,
  stravaOAuthConfigured: true,
  stravaAthleteName: null,
  aiConfigured: false,
  onboardingComplete: false,
  aiProvider: null,
  lastSync: null,
  userId: null,
  setGarminConnected: (v) =>
    set({
      garminConnected: v,
      onboardingComplete: hasFitnessSource({ garminConnected: v, stravaConnected: get().stravaConnected }) && get().aiConfigured,
    }),
  setAiConfigured: (v) =>
    set({
      aiConfigured: v,
      onboardingComplete: hasFitnessSource(get()) && v,
    }),
  setOnboardingComplete: (v) => set({ onboardingComplete: v }),
  setAiProvider: (v) => set({ aiProvider: v }),
  setLastSync: (d) => set({ lastSync: d }),
  setUserId: (id) => set({ userId: id }),
  setStatusFromApi: ({
    garminActive,
    stravaConnected,
    stravaOAuthConfigured,
    stravaAthleteName,
    aiConfigured,
    aiProvider,
  }) =>
    set({
      garminConnected: garminActive,
      stravaConnected,
      stravaOAuthConfigured: stravaOAuthConfigured ?? true,
      stravaAthleteName,
      aiConfigured,
      aiProvider,
      onboardingComplete:
        hasFitnessSource({ garminConnected: garminActive, stravaConnected }) && aiConfigured,
    }),
}));
