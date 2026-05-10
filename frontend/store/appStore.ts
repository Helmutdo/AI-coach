import { create } from "zustand";

export type AppStore = {
  garminConnected: boolean;
  /** True when at least one GarminActivity row exists for this user (includes CSV imports). Independent of OAuth. */
  hasGarminData: boolean;
  stravaConnected: boolean;
  /** From GET /api/strava/status — false if server env lacks Strava OAuth vars */
  stravaOAuthConfigured: boolean;
  stravaAthleteName: string | null;
  aiConfigured: boolean;
  onboardingComplete: boolean;
  aiProvider: string | null;
  lastSync: Date | null;
  userId: string | null;
  /** Custom display name set by the user, overrides Google OAuth name. */
  displayName: string | null;
  setGarminConnected: (v: boolean) => void;
  setAiConfigured: (v: boolean) => void;
  setOnboardingComplete: (v: boolean) => void;
  setAiProvider: (v: string | null) => void;
  setLastSync: (d: Date | null) => void;
  setUserId: (id: string | null) => void;
  setDisplayName: (name: string | null) => void;
  setStatusFromApi: (g: {
    garminActive: boolean;
    garminHasData?: boolean;
    stravaConnected: boolean;
    stravaOAuthConfigured?: boolean;
    stravaAthleteName: string | null;
    aiConfigured: boolean;
    aiProvider: string | null;
  }) => void;
};

function hasFitnessSource(g: {
  garminConnected: boolean;
  hasGarminData: boolean;
  stravaConnected: boolean;
}) {
  return g.garminConnected || g.hasGarminData || g.stravaConnected;
}

export const useAppStore = create<AppStore>((set, get) => ({
  garminConnected: false,
  hasGarminData: false,
  stravaConnected: false,
  stravaOAuthConfigured: true,
  stravaAthleteName: null,
  aiConfigured: false,
  onboardingComplete: false,
  aiProvider: null,
  lastSync: null,
  userId: null,
  displayName: null,
  setGarminConnected: (v) =>
    set({
      garminConnected: v,
      onboardingComplete:
        hasFitnessSource({
          garminConnected: v,
          hasGarminData: get().hasGarminData,
          stravaConnected: get().stravaConnected,
        }) && get().aiConfigured,
    }),
  setAiConfigured: (v) =>
    set({
      aiConfigured: v,
      onboardingComplete:
        hasFitnessSource({
          garminConnected: get().garminConnected,
          hasGarminData: get().hasGarminData,
          stravaConnected: get().stravaConnected,
        }) && v,
    }),
  setOnboardingComplete: (v) => set({ onboardingComplete: v }),
  setAiProvider: (v) => set({ aiProvider: v }),
  setLastSync: (d) => set({ lastSync: d }),
  setUserId: (id) => set({ userId: id }),
  setDisplayName: (name) => set({ displayName: name }),
  setStatusFromApi: ({
    garminActive,
    garminHasData,
    stravaConnected,
    stravaOAuthConfigured,
    stravaAthleteName,
    aiConfigured,
    aiProvider,
  }) =>
    set({
      garminConnected: garminActive,
      hasGarminData: garminHasData ?? get().hasGarminData,
      stravaConnected,
      stravaOAuthConfigured: stravaOAuthConfigured ?? true,
      stravaAthleteName,
      aiConfigured,
      aiProvider,
      onboardingComplete:
        hasFitnessSource({
          garminConnected: garminActive,
          hasGarminData: garminHasData ?? get().hasGarminData,
          stravaConnected,
        }) && aiConfigured,
    }),
}));
