import { create } from "zustand";

export type AppStore = {
  garminConnected: boolean;
  aiConfigured: boolean;
  lastSync: Date | null;
  setGarminConnected: (v: boolean) => void;
  setAiConfigured: (v: boolean) => void;
  setLastSync: (d: Date | null) => void;
};

export const useAppStore = create<AppStore>((set) => ({
  garminConnected: false,
  aiConfigured: false,
  lastSync: null,
  setGarminConnected: (v) => set({ garminConnected: v }),
  setAiConfigured: (v) => set({ aiConfigured: v }),
  setLastSync: (d) => set({ lastSync: d }),
}));
