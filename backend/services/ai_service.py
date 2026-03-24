"""
LLM coach: Anthropic (Claude), OpenAI (GPT-4o), or Google AI Studio (Gemini) with shared prompts.
"""

from __future__ import annotations

import json
import logging
import os
import re
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

_SYSTEM_COACH = """You are an expert endurance sports coach with access to the athlete's real Garmin data.
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


def _activity_sort_key(a: dict[str, Any]) -> datetime:
    return _activity_datetime(a)


def _activity_local_date(a: dict[str, Any]) -> date | None:
    st = a.get("start_time")
    if isinstance(st, datetime):
        return st.date()
    if isinstance(st, date) and not isinstance(st, datetime):
        return st
    if isinstance(st, str):
        return _as_date(st)
    return None


def _fmt_duration(sec: Any) -> str:
    if sec is None:
        return "—"
    try:
        s = int(sec)
    except (TypeError, ValueError):
        return str(sec)
    if s < 0:
        return "—"
    m, s = divmod(s, 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h}h {m}m"
    return f"{m}m {s}s"


def _training_load_sum_for_range(
    activities: list[dict[str, Any]],
    start_d: date,
    end_d: date,
) -> float:
    total = 0.0
    for a in activities:
        d = _activity_local_date(a)
        if d is None or d < start_d or d > end_d:
            continue
        tl = a.get("training_load")
        if tl is not None:
            try:
                total += float(tl)
            except (TypeError, ValueError):
                pass
    return total


def _weekly_load_trend_text(activities: list[dict[str, Any]]) -> str:
    today = date.today()
    last_start = today - timedelta(days=6)
    prior_end = today - timedelta(days=7)
    prior_start = today - timedelta(days=13)

    last7 = _training_load_sum_for_range(activities, last_start, today)
    prev7 = _training_load_sum_for_range(activities, prior_start, prior_end)

    if prev7 <= 0 and last7 <= 0:
        return "Insufficient training load data in the last two weeks to establish a trend."
    if prev7 <= 0:
        return f"Last 7d total training load ≈ {last7:.1f} (no comparable prior week)."
    delta_pct = ((last7 - prev7) / prev7) * 100.0
    direction = "up" if delta_pct > 5 else "down" if delta_pct < -5 else "stable"
    return (
        f"Last 7d total training load ≈ {last7:.1f}; prior 7d ≈ {prev7:.1f} "
        f"({direction}, ~{delta_pct:+.1f}% vs prior week)."
    )


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

    def build_context(self, activities: list[Any], daily_metrics: list[Any]) -> str:
        """Structured text for LLM consumption: last 10 activities, 14d wellness, load trend."""
        act_list = [a for a in activities if isinstance(a, dict)]
        met_list = [m for m in daily_metrics if isinstance(m, dict)]

        act_sorted = sorted(act_list, key=_activity_sort_key, reverse=True)[:10]

        lines: list[str] = []
        lines.append("=== RECENT ACTIVITIES (up to 10, newest first) ===")
        for i, a in enumerate(act_sorted, 1):
            st = a.get("start_time")
            date_s = "—"
            if isinstance(st, datetime):
                date_s = st.date().isoformat()
            elif isinstance(st, str):
                date_s = st[:10]
            elif isinstance(st, date):
                date_s = st.isoformat()
            lines.append(
                f"{i}. {a.get('activity_type') or 'unknown'} | {a.get('activity_name') or 'unnamed'} | "
                f"date={date_s} | duration={_fmt_duration(a.get('duration_seconds'))} | "
                f"avg_HR={a.get('avg_heart_rate', '—')} | training_load={a.get('training_load', '—')}"
            )

        # Daily metrics: last 14 calendar days by date descending
        dated: list[tuple[date, dict[str, Any]]] = []
        for m in met_list:
            d = _as_date(m.get("date"))
            if d:
                dated.append((d, m))
        dated.sort(key=lambda x: x[0], reverse=True)
        last14 = dated[:14]

        lines.append("")
        lines.append("=== DAILY WELLNESS (last 14 days, newest first) ===")
        for d, m in last14:
            lines.append(
                f"{d.isoformat()}: sleep_score={m.get('sleep_score', '—')} | "
                f"HRV_status={m.get('hrv_status', '—')} | "
                f"avg_stress={m.get('avg_stress', '—')} | "
                f"body_battery={m.get('body_battery_min', '—')}-{m.get('body_battery_max', '—')} | "
                f"steps={m.get('steps', '—')} | RHR={m.get('resting_heart_rate', '—')}"
            )

        lines.append("")
        lines.append("=== TRAINING LOAD TREND (approximate) ===")
        lines.append(_weekly_load_trend_text(act_list))

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
        activities: list[Any],
        daily_metrics: list[Any],
    ) -> dict[str, Any]:
        """JSON analysis: fatigue, readiness, observations, recommendations."""
        ctx = self.build_context(activities, daily_metrics)
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
