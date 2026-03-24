import { create } from "zustand";

export type AppStore = {
  garminConnected: boolean;
  aiConfigured: boolean;
  /** True when both Garmin session and AI key are configured (from API). */
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
  /** Sync all flags from GET /api/auth/garmin/status + GET /api/auth/ai/status */
  setStatusFromApi: (g: {
    garminActive: boolean;
    aiConfigured: boolean;
    aiProvider: string | null;
  }) => void;
};

export const useAppStore = create<AppStore>((set, get) => ({
  garminConnected: false,
  aiConfigured: false,
  onboardingComplete: false,
  aiProvider: null,
  lastSync: null,
  userId: null,
  setGarminConnected: (v) =>
    set({
      garminConnected: v,
      onboardingComplete: v && get().aiConfigured,
    }),
  setAiConfigured: (v) =>
    set({
      aiConfigured: v,
      onboardingComplete: get().garminConnected && v,
    }),
  setOnboardingComplete: (v) => set({ onboardingComplete: v }),
  setAiProvider: (v) => set({ aiProvider: v }),
  setLastSync: (d) => set({ lastSync: d }),
  setUserId: (id) => set({ userId: id }),
  setStatusFromApi: ({ garminActive, aiConfigured, aiProvider }) =>
    set({
      garminConnected: garminActive,
      aiConfigured,
      aiProvider,
      onboardingComplete: garminActive && aiConfigured,
    }),
}));
