"""LLM coach via OpenRouter (OpenAI-compatible API) with Langfuse observability."""

from __future__ import annotations

import json
import logging
import os
import re
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

logger = logging.getLogger(__name__)

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_MODEL = (os.getenv("OPENROUTER_MODEL") or "openai/gpt-4o").strip() or "openai/gpt-4o"
MAX_TOKENS = 1500

_SYSTEM_COACH_TEMPLATE = """You are TriCoach — a sharp, data-obsessed endurance coach who lives and breathes triathlon. \
You combine the analytical rigor of a sports scientist with the directness of a coach who has stood at the finish line hundreds of times.

Your domain: swim · bike · run training, triathlon periodization, recovery science, HRV, TSS, \
CTL/ATL/TSB, power, pace, HR zones, race nutrition, injury prevention, and the mental side of endurance sport.

SCOPE: Endurance sport only. If asked anything outside this domain, decline in one line and redirect \
to training — no lectures, no apologies. Use the athlete's own language for this.

LANGUAGE: Always reply in the same language the athlete writes in. Match their register (casual → casual, technical → technical).

── USING ATHLETE DATA ──
The athlete's profile and real training data appear below. Read them before every response.

Data present → cite specific numbers, dates, and trends in every recommendation. \
End with one concrete next action tied to their actual metrics. Generic advice is a last resort.

Data absent or sparse → acknowledge you need real data to personalize coaching; \
mention they can upload a Garmin CSV or connect Strava from Settings. Cap general guidance at 3 sentences.

Never invent numbers. Never assume values not in the context.

Today: {today}"""

# Use Langfuse-instrumented OpenAI client when available; fall back to plain OpenAI.
try:
    from langfuse.openai import OpenAI as _OpenAIClient
    _LANGFUSE = True
except ImportError:
    from openai import OpenAI as _OpenAIClient  # type: ignore[assignment]
    _LANGFUSE = False


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
    dt = _activity_datetime(a)
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

    return {
        "overall_status": str(data.get("overall_status", "unknown")),
        "fatigue_level": _clamp_int(data.get("fatigue_level"), 1, 10, 5),
        "readiness_score": _clamp_int(data.get("readiness_score"), 1, 10, 5),
        "key_observations": _as_str_list(data.get("key_observations")),
        "recommendations": _as_str_list(data.get("recommendations")),
    }


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


class AICoachService:
    """Coach LLM via OpenRouter with optional Langfuse observability."""

    def __init__(self) -> None:
        api_key = (os.getenv("OPEN_ROUTER_APIKEY") or "").strip()
        if not api_key:
            raise ValueError(
                "OPEN_ROUTER_APIKEY is not configured — set it in the backend environment."
            )
        self._client = _OpenAIClient(
            api_key=api_key,
            base_url=OPENROUTER_BASE_URL,
        )

    def _lf(
        self,
        name: str,
        user_id: str | None = None,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        """Langfuse-specific kwargs; empty dict when Langfuse is not available.
        Uses metadata for user_id to avoid passing unsupported kwargs to OpenAI API.
        """
        if not _LANGFUSE:
            return {}
        meta: dict[str, Any] = {}
        if user_id:
            meta["user_id"] = user_id
        if session_id:
            meta["session_id"] = session_id
        kw: dict[str, Any] = {"name": name}
        if meta:
            kw["metadata"] = meta
        return kw

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

        today = date.today()
        lines.append(f"Data as of: {today.isoformat()} ({today.strftime('%A')})")
        lines.append("")
        lines.append("── CONNECTED SOURCES ──")
        g_status = "Garmin ✓" if garmin_connected else "Garmin not connected"
        if strava_connected:
            if strava_athlete_name and str(strava_athlete_name).strip():
                st_status = f"Strava ✓ ({str(strava_athlete_name).strip()})"
            else:
                st_status = "Strava ✓"
        else:
            st_status = "Strava not connected"
        lines.append(f"{g_status} | {st_status}")

        lines.append("")
        lines.append("── RECENT ACTIVITIES (last 15, newest first) ──")
        for u in last15:
            ds = u.act_date.isoformat()
            dur_min = int(round(u.duration_min))
            dkm_s = f"{u.distance_km:.1f}" if u.distance_km is not None else "—"
            lines.append(
                f"- {ds} {u.source} {u.type}: {dur_min}min, {dkm_s}km, "
                f"avg HR {_fmt_hr(u.avg_hr)}bpm, effort {_fmt_effort(u.effort_0_5)}/5"
            )
        if not last15:
            lines.append("(no activities in the loaded window)")

        lines.append("")
        lines.append("── WEEKLY LOAD (last 4 weeks) ──")
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

        lines.append("")
        lines.append("── DAILY WELLNESS (Garmin, last 14 days) ──")
        dated: list[tuple[date, dict[str, Any]]] = []
        for m in met_list:
            d = _as_date(m.get("date"))
            if d:
                dated.append((d, m))
        dated.sort(key=lambda x: x[0], reverse=True)
        last14 = dated[:14]
        for d, m in last14:
            rmssd = m.get("hrv_rmssd_ms")
            avg7d = m.get("hrv_7d_avg_ms")
            ref_lo = m.get("hrv_ref_low_ms")
            ref_hi = m.get("hrv_ref_high_ms")
            hrv_part = m.get("hrv_status", "—")
            if rmssd is not None:
                hrv_part = f"{rmssd:.0f}ms"
                if avg7d is not None:
                    hrv_part += f" (7d avg {avg7d:.0f}ms"
                    if ref_lo is not None and ref_hi is not None:
                        hrv_part += f", ref {ref_lo:.0f}-{ref_hi:.0f}ms"
                    hrv_part += ")"
            lines.append(
                f"{d.isoformat()}: sleep_score={m.get('sleep_score', '—')} | "
                f"HRV={hrv_part} | "
                f"avg_stress={m.get('avg_stress', '—')} | "
                f"body_battery={m.get('body_battery_min', '—')}-{m.get('body_battery_max', '—')} | "
                f"steps={m.get('steps', '—')} | RHR={m.get('resting_heart_rate', '—')}"
            )
        if not last14:
            lines.append("(no daily metrics available)")

        lines.append("")
        lines.append("── PATTERNS ──")
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
        *,
        user_id: str | None = None,
        conversation_id: str | None = None,
    ) -> str:
        """Multi-turn chat with system prompt including athlete context."""
        system_prompt = _SYSTEM_COACH_TEMPLATE.format(today=date.today().isoformat())
        system = f"{system_prompt}\n\n── ATHLETE CONTEXT ──\n{context}"
        hist = self._normalize_history(conversation_history)
        messages: list[dict[str, str]] = [{"role": "system", "content": system}]
        for m in hist:
            messages.append({"role": m["role"], "content": m["content"]})
        messages.append({"role": "user", "content": user_message})

        comp = self._client.chat.completions.create(
            model=OPENROUTER_MODEL,
            max_tokens=MAX_TOKENS,
            messages=messages,
            **self._lf("coach-chat", user_id=user_id, session_id=conversation_id),
        )
        return (comp.choices[0].message.content or "").strip() or "(empty response)"

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
        user_id: str | None = None,
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
        messages: list[dict[str, str]] = [
            {"role": "system", "content": "You output only compact JSON for coaching analytics."},
            {"role": "user", "content": instruction + ctx},
        ]
        comp = self._client.chat.completions.create(
            model=OPENROUTER_MODEL,
            max_tokens=MAX_TOKENS,
            messages=messages,
            **self._lf("coach-analysis", user_id=user_id),
        )
        raw = (comp.choices[0].message.content or "").strip()
        return _parse_analysis_result(raw)
