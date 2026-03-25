"""
LLM coach: Anthropic (Claude), OpenAI (GPT-4o), or Google AI Studio (Gemini) with shared prompts.
"""

from __future__ import annotations

import json
import logging
import os
import re
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

import google.genai as genai
from anthropic import Anthropic
from openai import OpenAI

logger = logging.getLogger(__name__)

ANTHROPIC_MODEL = "claude-sonnet-4-20250514"
OPENAI_MODEL = "gpt-4o"
# Google AI Studio / Gemini — override with GEMINI_MODEL if needed
GEMINI_MODEL = (os.getenv("GEMINI_MODEL") or "gemini-2.0-flash").strip() or "gemini-2.0-flash"
MAX_TOKENS = 1500

_SYSTEM_COACH = """You are an expert endurance sports coach with access to the athlete's real training data
from Garmin Connect and/or Strava when connected.
Analyze their metrics and provide personalized, evidence-based training recommendations.
Be specific, reference their actual data, and explain the reasoning behind your recommendations."""


def _normalize_provider(provider: str) -> str:
    p = (provider or "anthropic").strip().lower()
    if p not in ("anthropic", "openai", "google"):
        raise ValueError(
            f"Unsupported AI provider: {provider!r}. Use 'anthropic', 'openai', or 'google'."
        )
    return p


def _as_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


_EPOCH = datetime(1970, 1, 1)


def _activity_datetime(a: dict[str, Any]) -> datetime:
    st = a.get("start_time")
    if isinstance(st, datetime):
        return st.replace(tzinfo=None) if st.tzinfo else st
    if isinstance(st, str):
        try:
            s = st.replace("Z", "+00:00")
            dt = datetime.fromisoformat(s)
            return dt.replace(tzinfo=None) if dt.tzinfo else dt
        except ValueError:
            pass
    return _EPOCH


@dataclass
class _UnifiedActivity:
    sort_dt: datetime
    act_date: date
    source: str
    type: str
    duration_min: float
    distance_km: float
    avg_hr: float | None
    effort_0_5: float | None
    is_hard: bool


def _strava_activity_datetime(a: dict[str, Any]) -> datetime:
    st = a.get("start_time")
    if isinstance(st, datetime):
        return st.replace(tzinfo=None) if st.tzinfo else st
    if isinstance(st, str):
        try:
            s = st.replace("Z", "+00:00")
            dt = datetime.fromisoformat(s)
            return dt.replace(tzinfo=None) if dt.tzinfo else dt
        except ValueError:
            pass
    return _EPOCH


def _unified_from_garmin(a: dict[str, Any]) -> _UnifiedActivity | None:
    dt = _activity_datetime(a)
    if dt == _EPOCH:
        return None
    d = dt.date()
    dur = a.get("duration_seconds")
    try:
        dmin = float(dur) / 60.0 if dur is not None else 0.0
    except (TypeError, ValueError):
        dmin = 0.0
    dist_m = a.get("distance_meters")
    try:
        dkm = float(dist_m) / 1000.0 if dist_m is not None else 0.0
    except (TypeError, ValueError):
        dkm = 0.0
    hr = a.get("avg_heart_rate")
    try:
        hr_f = float(hr) if hr is not None else None
    except (TypeError, ValueError):
        hr_f = None
    ae = a.get("aerobic_effect")
    try:
        ae_f = float(ae) if ae is not None else None
    except (TypeError, ValueError):
        ae_f = None
    effort = min(max(ae_f, 0.0), 5.0) if ae_f is not None else None
    is_hard = bool(ae_f is not None and ae_f > 4.0)
    typ = str(a.get("activity_type") or "unknown")
    return _UnifiedActivity(
        sort_dt=dt,
        act_date=d,
        source="[Garmin]",
        type=typ,
        duration_min=dmin,
        distance_km=dkm,
        avg_hr=hr_f,
        effort_0_5=effort,
        is_hard=is_hard,
    )


def _unified_from_strava(a: dict[str, Any]) -> _UnifiedActivity | None:
    dt = _strava_activity_datetime(a)
    if dt == _EPOCH:
        return None
    d = dt.date()
    mt = a.get("moving_time")
    if mt is None:
        mt = a.get("elapsed_time")
    try:
        dmin = float(mt) / 60.0 if mt is not None else 0.0
    except (TypeError, ValueError):
        dmin = 0.0
    dist_m = a.get("distance")
    try:
        dkm = float(dist_m) / 1000.0 if dist_m is not None else 0.0
    except (TypeError, ValueError):
        dkm = 0.0
    hr = a.get("avg_heartrate")
    try:
        hr_f = float(hr) if hr is not None else None
    except (TypeError, ValueError):
        hr_f = None
    ss = a.get("suffer_score")
    try:
        ss_f = float(ss) if ss is not None else None
    except (TypeError, ValueError):
        ss_f = None
    if ss_f is not None:
        effort = min(max(ss_f / 30.0, 0.0), 5.0)
    else:
        effort = None
    is_hard = bool(ss_f is not None and ss_f > 70.0)
    typ = str(a.get("sport_type") or "unknown")
    return _UnifiedActivity(
        sort_dt=dt,
        act_date=d,
        source="[Strava]",
        type=typ,
        duration_min=dmin,
        distance_km=dkm,
        avg_hr=hr_f,
        effort_0_5=effort,
        is_hard=is_hard,
    )


def _merge_unified(
    garmin_activities: list[dict[str, Any]],
    strava_activities: list[dict[str, Any]],
) -> list[_UnifiedActivity]:
    out: list[_UnifiedActivity] = []
    for a in garmin_activities:
        if isinstance(a, dict):
            u = _unified_from_garmin(a)
            if u:
                out.append(u)
    for a in strava_activities:
        if isinstance(a, dict):
            u = _unified_from_strava(a)
            if u:
                out.append(u)
    out.sort(key=lambda x: x.sort_dt, reverse=True)
    return out


def _fmt_hr(hr: float | None) -> str:
    if hr is None:
        return "—"
    try:
        return str(int(round(hr)))
    except (TypeError, ValueError):
        return "—"


def _fmt_effort(eff: float | None) -> str:
    if eff is None:
        return "—"
    return f"{eff:.1f}"


def _week_type_summary(types: Counter[str]) -> str:
    if not types:
        return "—"
    parts = [f"{t} x{c}" for t, c in types.most_common()]
    return ", ".join(parts)


def _longest_streak_days(dates: list[date]) -> int:
    if not dates:
        return 0
    uniq = sorted(set(dates))
    best = 1
    cur = 1
    for i in range(1, len(uniq)):
        if (uniq[i] - uniq[i - 1]).days == 1:
            cur += 1
            best = max(best, cur)
        else:
            cur = 1
    return best


def _extract_json_object(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


def _parse_analysis_result(raw: str) -> dict[str, Any]:
    try:
        data = _extract_json_object(raw)
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning("Failed to parse analysis JSON: %s", e)
        return _fallback_analysis("Model did not return valid JSON.")

    out: dict[str, Any] = {
        "overall_status": str(data.get("overall_status", "unknown")),
        "fatigue_level": _clamp_int(data.get("fatigue_level"), 1, 10, 5),
        "readiness_score": _clamp_int(data.get("readiness_score"), 1, 10, 5),
        "key_observations": _as_str_list(data.get("key_observations")),
        "recommendations": _as_str_list(data.get("recommendations")),
    }
    return out


def _clamp_int(v: Any, lo: int, hi: int, default: int) -> int:
    try:
        x = int(round(float(v)))
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, x))


def _as_str_list(v: Any) -> list[str]:
    if v is None:
        return []
    if isinstance(v, list):
        return [str(x) for x in v if x is not None]
    return [str(v)]


def _fallback_analysis(msg: str) -> dict[str, Any]:
    return {
        "overall_status": "unknown",
        "fatigue_level": 5,
        "readiness_score": 5,
        "key_observations": [msg],
        "recommendations": [],
    }


def _gemini_response_text(response: Any) -> str:
    try:
        t = getattr(response, "text", None)
        return (t or "").strip() if t is not None else ""
    except (ValueError, AttributeError):
        return ""


class AICoachService:
    """Coach LLM with Anthropic, OpenAI, or Google Gemini (AI Studio API key)."""

    def __init__(self, api_key: str, provider: str) -> None:
        if not (api_key and str(api_key).strip()):
            raise ValueError("api_key is required")
        self._api_key = str(api_key).strip()
        self.provider = _normalize_provider(provider)
        self._anthropic: Anthropic | None = None
        self._openai: OpenAI | None = None
        self._genai_client: genai.Client | None = None
        if self.provider == "anthropic":
            self._anthropic = Anthropic(api_key=self._api_key)
        elif self.provider == "openai":
            self._openai = OpenAI(api_key=self._api_key)
        else:
            self._genai_client = genai.Client(api_key=self._api_key)

    def build_context(
        self,
        garmin_activities: list[Any] | None = None,
        garmin_metrics: list[Any] | None = None,
        strava_activities: list[Any] | None = None,
        *,
        garmin_connected: bool = False,
        strava_connected: bool = False,
        strava_athlete_name: str | None = None,
    ) -> str:
        """Structured coach context: merged activities, weekly summary, Garmin wellness, patterns."""
        g_list = [a for a in (garmin_activities or []) if isinstance(a, dict)]
        s_list = [a for a in (strava_activities or []) if isinstance(a, dict)]
        met_list = [m for m in (garmin_metrics or []) if isinstance(m, dict)]

        merged = _merge_unified(g_list, s_list)
        last15 = merged[:15]

        lines: list[str] = []

        # SECTION 1 — Athlete data sources
        lines.append("=== ATHLETE DATA SOURCES ===")
        g_status = "Garmin ✓" if garmin_connected else "Garmin not connected"
        if strava_connected:
            if strava_athlete_name and str(strava_athlete_name).strip():
                st_status = f"Strava ✓ as {str(strava_athlete_name).strip()}"
            else:
                st_status = "Strava ✓"
        else:
            st_status = "Strava not connected"
        lines.append(f"Connected sources: {g_status} | {st_status}")

        # SECTION 2 — Recent activities (last 15, merged)
        lines.append("")
        lines.append("=== RECENT ACTIVITIES (last 15, merged, newest first) ===")
        for u in last15:
            ds = u.act_date.isoformat()
            dur_min = int(round(u.duration_min))
            dkm = u.distance_km
            dkm_s = f"{dkm:.1f}" if dkm is not None else "—"
            lines.append(
                f"- {ds} {u.source} {u.type}: {dur_min}min, {dkm_s}km, "
                f"avg HR {_fmt_hr(u.avg_hr)}bpm, effort {_fmt_effort(u.effort_0_5)}/5"
            )
        if not last15:
            lines.append("(no activities in the loaded window)")

        # SECTION 3 — Weekly load summary (last 4 calendar weeks, Mon–Sun)
        lines.append("")
        lines.append("=== WEEKLY LOAD SUMMARY (last 4 weeks) ===")
        today = date.today()
        monday = today - timedelta(days=today.weekday())
        for i in range(4):
            week_start = monday - timedelta(weeks=(3 - i))
            week_end = week_start + timedelta(days=6)
            in_week = [u for u in merged if week_start <= u.act_date <= week_end]
            n = len(in_week)
            total_h = sum(u.duration_min for u in in_week) / 60.0
            tc: Counter[str] = Counter(u.type for u in in_week)
            lines.append(
                f"Week of {week_start.isoformat()}: {n} sessions, {total_h:.1f}h, "
                f"types: {_week_type_summary(tc)}"
            )

        # SECTION 4 — Daily health metrics from Garmin (last 14 days)
        lines.append("")
        lines.append("=== DAILY HEALTH METRICS (Garmin, last 14 days, newest first) ===")
        dated: list[tuple[date, dict[str, Any]]] = []
        for m in met_list:
            d = _as_date(m.get("date"))
            if d:
                dated.append((d, m))
        dated.sort(key=lambda x: x[0], reverse=True)
        last14 = dated[:14]
        for d, m in last14:
            lines.append(
                f"{d.isoformat()}: sleep_score={m.get('sleep_score', '—')} | "
                f"HRV_status={m.get('hrv_status', '—')} | "
                f"avg_stress={m.get('avg_stress', '—')} | "
                f"body_battery={m.get('body_battery_min', '—')}-{m.get('body_battery_max', '—')} | "
                f"steps={m.get('steps', '—')} | RHR={m.get('resting_heart_rate', '—')}"
            )
        if not last14:
            lines.append("(no daily metrics available)")

        # SECTION 5 — Notable patterns
        lines.append("")
        lines.append("=== NOTABLE PATTERNS (computed from loaded activities) ===")
        if merged:
            mc = Counter(u.type for u in merged)
            top_type, top_n = mc.most_common(1)[0]
            lines.append(f"- Most frequent sport type: {top_type} ({top_n} sessions)")
        else:
            lines.append("- Most frequent sport type: —")
        total_hours = sum(u.duration_min for u in merged) / 60.0
        avg_week_h = total_hours / 4.0 if merged else 0.0
        lines.append(f"- Avg weekly volume (hours, over last 4 weeks window): {avg_week_h:.1f}h")
        streak = _longest_streak_days([u.act_date for u in merged])
        lines.append(f"- Longest streak of consecutive training days: {streak} days")
        hard_dates = [u.act_date for u in merged if u.is_hard]
        if hard_dates:
            last_hard = max(hard_dates)
            days_since = (today - last_hard).days
            lines.append(
                f"- Days since last hard effort (Strava suffer >70 or Garmin aerobic TE >4): {days_since} days"
            )
        else:
            lines.append(
                "- Days since last hard effort: no qualifying session in loaded data "
                "(Strava suffer_score >70 or Garmin aerobic_effect >4)"
            )

        return "\n".join(lines)

    def chat(
        self,
        user_message: str,
        context: str,
        conversation_history: list[Any],
    ) -> str:
        """Multi-turn chat with system prompt including Garmin context."""
        system = (
            f"{_SYSTEM_COACH}\n\nCurrent athlete data context:\n{context}"
        )
        hist = self._normalize_history(conversation_history)
        if self.provider == "anthropic":
            assert self._anthropic is not None
            messages: list[dict[str, Any]] = list(hist)
            messages.append({"role": "user", "content": user_message})
            resp = self._anthropic.messages.create(
                model=ANTHROPIC_MODEL,
                max_tokens=MAX_TOKENS,
                system=system,
                messages=messages,
            )
            blocks = getattr(resp, "content", []) or []
            parts: list[str] = []
            for b in blocks:
                if getattr(b, "type", None) == "text":
                    parts.append(getattr(b, "text", "") or "")
            return "".join(parts).strip() or "(empty response)"

        if self.provider == "openai":
            assert self._openai is not None
            oai_messages: list[dict[str, str]] = [{"role": "system", "content": system}]
            for m in hist:
                oai_messages.append({"role": m["role"], "content": m["content"]})
            oai_messages.append({"role": "user", "content": user_message})
            comp = self._openai.chat.completions.create(
                model=OPENAI_MODEL,
                max_tokens=MAX_TOKENS,
                messages=oai_messages,
            )
            choice = comp.choices[0].message.content
            return (choice or "").strip() or "(empty response)"

        assert self._genai_client is not None
        history_gemini: list[genai.types.Content] = []
        for m in hist:
            role = "user" if m["role"] == "user" else "model"
            history_gemini.append(
                genai.types.Content(
                    role=role,
                    parts=[genai.types.Part(text=m["content"])],
                )
            )
        g_chat = self._genai_client.chats.create(
            model=GEMINI_MODEL,
            config=genai.types.GenerateContentConfig(
                system_instruction=system,
                max_output_tokens=MAX_TOKENS,
            ),
            history=history_gemini,
        )
        g_resp = g_chat.send_message(user_message)
        return _gemini_response_text(g_resp) or "(empty response)"

    def _normalize_history(self, conversation_history: list[Any]) -> list[dict[str, str]]:
        out: list[dict[str, str]] = []
        for item in conversation_history:
            if not isinstance(item, dict):
                continue
            role = item.get("role")
            content = item.get("content")
            if role not in ("user", "assistant") or content is None:
                continue
            out.append({"role": role, "content": str(content)})
        return out

    def analyze_training_load(
        self,
        garmin_activities: list[Any] | None = None,
        garmin_metrics: list[Any] | None = None,
        strava_activities: list[Any] | None = None,
        *,
        garmin_connected: bool = False,
        strava_connected: bool = False,
        strava_athlete_name: str | None = None,
    ) -> dict[str, Any]:
        """JSON analysis: fatigue, readiness, observations, recommendations."""
        ctx = self.build_context(
            garmin_activities=garmin_activities,
            garmin_metrics=garmin_metrics,
            strava_activities=strava_activities,
            garmin_connected=garmin_connected,
            strava_connected=strava_connected,
            strava_athlete_name=strava_athlete_name,
        )
        instruction = """Based on the athlete data below, analyze overtraining risk, recovery status,
and readiness for hard training. Respond with ONLY a valid JSON object (no markdown fences) using exactly these keys:
{
  "overall_status": "<short string, e.g. balanced / high fatigue / building>",
  "fatigue_level": <integer 1-10>,
  "readiness_score": <integer 1-10>,
  "key_observations": ["...", "..."],
  "recommendations": ["...", "..."]
}
Use evidence from the metrics. Integers must be between 1 and 10.

ATHLETE DATA:
"""
        user_content = instruction + ctx

        if self.provider == "anthropic":
            assert self._anthropic is not None
            resp = self._anthropic.messages.create(
                model=ANTHROPIC_MODEL,
                max_tokens=MAX_TOKENS,
                system="You output only compact JSON for coaching analytics.",
                messages=[{"role": "user", "content": user_content}],
            )
            text = ""
            for b in getattr(resp, "content", []) or []:
                if getattr(b, "type", None) == "text":
                    text += getattr(b, "text", "") or ""
            return _parse_analysis_result(text)

        if self.provider == "openai":
            assert self._openai is not None
            comp = self._openai.chat.completions.create(
                model=OPENAI_MODEL,
                max_tokens=MAX_TOKENS,
                response_format={"type": "json_object"},
                messages=[
                    {
                        "role": "system",
                        "content": "You are a sports science analyst. Reply with JSON only.",
                    },
                    {"role": "user", "content": user_content},
                ],
            )
            raw = comp.choices[0].message.content or ""
            return _parse_analysis_result(raw)

        assert self._genai_client is not None
        g_resp = self._genai_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=user_content,
            config=genai.types.GenerateContentConfig(
                system_instruction="You output only compact JSON for coaching analytics.",
                max_output_tokens=MAX_TOKENS,
                response_mime_type="application/json",
            ),
        )
        raw = _gemini_response_text(g_resp)
        return _parse_analysis_result(raw)
