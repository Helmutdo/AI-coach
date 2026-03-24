/**
 * Typed Axios client for the Garmin AI Coach FastAPI backend.
 * Set NEXT_PUBLIC_API_URL (default http://127.0.0.1:8000).
 */

import axios, { type AxiosInstance } from "axios";

const baseURL =
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000"
    : process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export const api: AxiosInstance = axios.create({
  baseURL,
  headers: { "Content-Type": "application/json" },
  timeout: 120_000,
});

api.interceptors.response.use(
  (r) => r,
  (err: unknown) => {
    if (axios.isAxiosError(err) && err.response?.data) {
      const d = (err.response.data as { detail?: unknown }).detail;
      if (typeof d === "string") return Promise.reject(new Error(d));
      if (Array.isArray(d))
        return Promise.reject(new Error(d.map((x) => String(x)).join("; ")));
    }
    return Promise.reject(err);
  }
);

// ——— Types ———

export type GarminLoginBody = {
  email?: string | null;
  password?: string | null;
};

export type GarminLoginResponse = {
  status: string;
  email: string;
  profile: {
    full_name: string | null;
    user_summary: Record<string, unknown>;
  };
};

export type GarminStatusResponse = {
  active: boolean;
  oauth_tokens_present: boolean;
};

export type AIConfigureBody = {
  provider: "anthropic" | "openai" | "google";
  api_key: string;
};

export type AIConfigureResponse = {
  status: string;
  provider: string;
};

export type GarminSyncResponse = {
  synced_activities: number;
  synced_days: number;
  errors?: string[];
  partial?: boolean;
};

export type AIStatusResponse = {
  configured: boolean;
  provider: string | null;
};

export type GarminActivityRow = {
  id: number;
  activity_id: string;
  activity_name: string | null;
  activity_type: string | null;
  start_time: string | null;
  duration_seconds: number | null;
  distance_meters: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  calories: number | null;
  avg_pace: number | null;
  training_load: number | null;
  aerobic_effect: number | null;
  anaerobic_effect: number | null;
  synced_at: string | null;
};

export type DailyMetricRow = {
  id: number;
  date: string;
  resting_heart_rate: number | null;
  avg_stress: number | null;
  sleep_duration_seconds: number | null;
  sleep_score: number | null;
  steps: number | null;
  body_battery_min: number | null;
  body_battery_max: number | null;
  vo2max: number | null;
  hrv_status: string | null;
};

export type GarminSummaryResponse = {
  week_start: string;
  activities_this_week: number;
  avg_sleep_score: number | null;
  hrv_status_mode: string | null;
  current_body_battery: {
    date: string;
    min: number | null;
    max: number | null;
  } | null;
};

export type CoachAnalysis = {
  overall_status?: string;
  fatigue_level?: number;
  readiness_score?: number;
  key_observations?: string[];
  recommendations?: string[];
  [key: string]: unknown;
};

export type ChatMessageRow = {
  id: number;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string | null;
};

export type CoachChatBody = {
  message: string;
  conversation_id: string;
};

export type CoachChatResponse = {
  response: string;
  conversation_id: string;
  provider_error?: boolean;
};

// ——— Auth ———

export async function postGarminLogin(
  body?: GarminLoginBody
): Promise<GarminLoginResponse> {
  const { data } = await api.post<GarminLoginResponse>(
    "/api/auth/garmin/login",
    body ?? {}
  );
  return data;
}

export async function getGarminStatus(): Promise<GarminStatusResponse> {
  const { data } = await api.get<GarminStatusResponse>(
    "/api/auth/garmin/status"
  );
  return data;
}

export async function getAIStatus(): Promise<AIStatusResponse> {
  const { data } = await api.get<AIStatusResponse>("/api/auth/ai/status");
  return data;
}

export async function postAIConfigure(
  body: AIConfigureBody
): Promise<AIConfigureResponse> {
  const { data } = await api.post<AIConfigureResponse>(
    "/api/auth/ai/configure",
    body
  );
  return data;
}

// ——— Garmin data ———

export async function postGarminSync(): Promise<GarminSyncResponse> {
  const { data } = await api.post<GarminSyncResponse>("/api/garmin/sync");
  return data;
}

export async function getGarminActivities(params?: {
  limit?: number;
}): Promise<GarminActivityRow[]> {
  const { data } = await api.get<GarminActivityRow[]>(
    "/api/garmin/activities",
    { params: { limit: params?.limit ?? 20 } }
  );
  return data;
}

export async function getGarminDailyMetrics(params?: {
  days?: number;
}): Promise<DailyMetricRow[]> {
  const { data } = await api.get<DailyMetricRow[]>(
    "/api/garmin/daily-metrics",
    { params: { days: params?.days ?? 30 } }
  );
  return data;
}

export async function getGarminSummary(): Promise<GarminSummaryResponse> {
  const { data } = await api.get<GarminSummaryResponse>("/api/garmin/summary");
  return data;
}

// ——— Coach ———

export async function getCoachAnalysis(): Promise<CoachAnalysis> {
  const { data } = await api.get<CoachAnalysis>("/api/coach/analysis");
  return data;
}

export async function getCoachHistory(): Promise<ChatMessageRow[]> {
  const { data } = await api.get<ChatMessageRow[]>("/api/coach/history");
  return data;
}

export async function postCoachChat(
  body: CoachChatBody
): Promise<CoachChatResponse> {
  const { data } = await api.post<CoachChatResponse>(
    "/api/coach/chat",
    body
  );
  return data;
}
