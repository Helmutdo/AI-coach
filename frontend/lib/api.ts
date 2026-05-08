/**
 * Typed Axios client for the AI Coach FastAPI backend.
 * Set NEXT_PUBLIC_API_URL (default http://127.0.0.1:8000).
 * Sends X-User-Id from the Zustand store (set after POST /api/users/me).
 */

import axios, { type AxiosInstance } from "axios";

import { useAppStore } from "@/store/appStore";

const baseURL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export const api: AxiosInstance = axios.create({
  baseURL,
  headers: { "Content-Type": "application/json" },
  timeout: 120_000,
});

api.interceptors.request.use((config) => {
  const url = config.url ?? "";
  const skip = url.includes("/api/users/me");
  if (!skip && typeof window !== "undefined") {
    const id = useAppStore.getState().userId;
    if (id) {
      config.headers.set("X-User-Id", id);
    }
  }
  return config;
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
  /** Garmin account email when connected and stored on the server */
  garmin_email: string | null;
};

export type GarminSyncResponse = {
  synced_activities: number;
  synced_days: number;
  errors?: string[];
  partial?: boolean;
};

export type AIStatusResponse = {
  configured: boolean;
  model: string | null;
  provider?: string | null;
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
  source?: "garmin" | "csv";
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

export type AthleteProfileData = {
  sex: "male" | "female" | "other";
  birth_year: number;
  weight_kg: number;
  height_cm: number;
  injuries: string;
  hours_per_week?: number | null;
  experience?: "beginner" | "amateur" | "competitive" | null;
  years_in_triathlon?: number | null;
  target_distance?: "sprint" | "olympic" | "70.3" | "ironman" | null;
  primary_goal?: "finish" | "time_goal" | "fitness" | "weight" | null;
  next_race_date?: string | null;
};

// ——— User (backend) ———

export type UserMeBody = {
  google_id: string;
  email: string;
  name: string;
  avatar_url: string | null;
};

export type UserMeResponse = {
  id: string;
  google_id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export async function postUsersMe(body: UserMeBody): Promise<UserMeResponse> {
  const { data } = await api.post<UserMeResponse>("/api/users/me", body);
  return data;
}

export async function getProfile(): Promise<AthleteProfileData | null> {
  try {
    const { data } = await api.get<AthleteProfileData>("/api/profile");
    return data;
  } catch {
    return null;
  }
}

export async function saveProfile(profile: AthleteProfileData): Promise<AthleteProfileData> {
  const { data } = await api.post<AthleteProfileData>("/api/profile", profile);
  return data;
}

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

export async function deleteGarminDisconnect(): Promise<{ status: string }> {
  const { data } = await api.delete<{ status: string }>(
    "/api/auth/garmin/disconnect"
  );
  return data;
}

export type DeleteUserDataResponse = {
  status: string;
  deleted: {
    activities: number;
    strava_activities?: number;
    daily_metrics: number;
    chat_messages: number;
  };
};

export async function deleteUserData(): Promise<DeleteUserDataResponse> {
  const { data } = await api.delete<DeleteUserDataResponse>(
    "/api/users/me/data"
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
  days?: number;
}): Promise<GarminActivityRow[]> {
  const { data } = await api.get<GarminActivityRow[]>(
    "/api/garmin/activities",
    { params: { limit: params?.limit ?? 100, days: params?.days ?? 30 } }
  );
  return data;
}

export type CSVUploadResponse = {
  inserted: number;
  skipped: number;
  errors: string[];
  total_rows: number;
};

export async function uploadGarminCSV(file: File): Promise<CSVUploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<CSVUploadResponse>(
    "/api/garmin/upload-csv",
    form,
    { headers: { "Content-Type": "multipart/form-data" } }
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

// ——— Strava ———

export type StravaStatusResponse = {
  connected: boolean;
  athlete_name: string | null;
  athlete_id: string | null;
  last_sync: string | null;
  activity_count: number;
  /** False when backend .env is missing STRAVA_CLIENT_ID / SECRET / REDIRECT_URI */
  oauth_configured?: boolean;
};

export async function getStravaConnect(): Promise<{ auth_url: string }> {
  const { data } = await api.get<{ auth_url: string }>("/api/strava/connect");
  return data;
}

export async function getStravaStatus(): Promise<StravaStatusResponse> {
  const { data } = await api.get<StravaStatusResponse>("/api/strava/status");
  return data;
}

export async function deleteStravaDisconnect(): Promise<{ status: string }> {
  const { data } = await api.delete<{ status: string }>("/api/strava/disconnect");
  return data;
}

export type StravaSyncResponse = {
  synced: number;
  updated: number;
  errors: string[];
};

export async function postStravaSync(body?: {
  days_back?: number;
}): Promise<StravaSyncResponse> {
  const { data } = await api.post<StravaSyncResponse>(
    "/api/strava/sync",
    body ?? { days_back: 60 }
  );
  return data;
}

export type StravaActivityRow = {
  id: string;
  strava_id: string;
  name: string;
  sport_type: string;
  start_date: string;
  elapsed_time: number;
  distance: number;
  moving_time: number;
  total_elevation_gain: number;
  avg_heartrate: number | null;
  max_heartrate: number | null;
  avg_watts: number | null;
  weighted_avg_watts: number | null;
  suffer_score: number | null;
  avg_cadence: number | null;
  avg_speed: number | null;
  pr_count: number | null;
  achievement_count: number | null;
  kudos_count: number | null;
  map_polyline: string | null;
  synced_at: string | null;
};

export async function getStravaActivities(params?: {
  limit?: number;
  days?: number;
  sport_type?: string;
}): Promise<StravaActivityRow[]> {
  const { data } = await api.get<StravaActivityRow[]>("/api/strava/activities", {
    params: {
      limit: params?.limit ?? 100,
      days: params?.days ?? 30,
      sport_type: params?.sport_type,
    },
  });
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

export async function getCoachGreeting(): Promise<{ message: string }> {
  const { data } = await api.get<{ message: string }>("/api/coach/greeting");
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
