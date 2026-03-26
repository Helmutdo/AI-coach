"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAIStatus,
  getCoachHistory,
  postCoachChat,
  type ChatMessageRow,
} from "@/lib/api";
import { useAppStore } from "@/store/appStore";

const STORAGE_KEY = "garmin-ai-coach-conversation-id";

function sortByTime(a: ChatMessageRow, b: ChatMessageRow) {
  const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
  const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
  return ta - tb;
}

export default function CoachPage() {
  const userId = useAppStore((s) => s.userId);
  const [cid, setCid] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let id = sessionStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(STORAGE_KEY, id);
    }
    setCid(id);
    const prefill = sessionStorage.getItem("coach_prefill");
    if (prefill) {
      setInput(prefill);
      sessionStorage.removeItem("coach_prefill");
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const ai = await getAIStatus();
        setAiReady(ai.configured);
      } catch {
        setAiReady(false);
      }
    })();
  }, [userId]);

  const loadHistory = useCallback(async () => {
    if (!cid) return;
    setHistoryLoading(true);
    setErr(null);
    try {
      const rows = await getCoachHistory();
      const mine = rows
        .filter((r) => r.conversation_id === cid)
        .sort(sortByTime);
      setMessages(mine);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setHistoryLoading(false);
    }
  }, [cid]);

  useEffect(() => {
    if (!userId) return;
    if (aiReady) void loadHistory();
    else if (aiReady === false) setHistoryLoading(false);
  }, [loadHistory, aiReady, userId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || !cid || loading || !aiReady) return;
    setInput("");
    setLoading(true);
    setErr(null);
    try {
      await postCoachChat({ message: text, conversation_id: cid });
      await loadHistory();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Chat failed");
    } finally {
      setLoading(false);
    }
  }

  if (aiReady === null) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-zinc-500">
        Checking AI configuration…
      </div>
    );
  }

  if (!aiReady) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center justify-center gap-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 px-8 py-16 text-center">
        <h1 className="text-xl font-semibold text-zinc-100">Configure AI first</h1>
        <p className="text-sm text-zinc-500">
          Add an Anthropic or OpenAI API key in Settings to chat with your coach. Your messages
          use the last 30 days of synced Garmin data as context (handled by the backend).
        </p>
        <Link
          href="/settings"
          className="rounded-xl bg-emerald-600 px-6 py-3 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Open Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col">
      <div className="mb-4 shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">AI Coach</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Chat with your coach using synced Garmin context.
        </p>
      </div>

      {err && (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
          {err}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        {historyLoading && (
          <p className="text-center text-sm text-zinc-500">Loading history…</p>
        )}
        {!historyLoading && messages.length === 0 && (
          <p className="text-center text-sm text-zinc-500">No messages yet. Say hello below.</p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-emerald-600/30 text-emerald-50"
                  : "border border-zinc-700 bg-zinc-800/80 text-zinc-100"
              }`}
            >
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {m.role === "user" ? "You" : "Coach"}
              </p>
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-zinc-700 bg-zinc-800/80 px-4 py-3 text-sm text-zinc-400">
              <span className="inline-flex animate-pulse gap-1">●●●</span> Coach is thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <p className="mt-3 text-center text-xs text-zinc-600">
        Your coach has access to your last 30 days of Garmin data (activities + daily metrics in
        the database).
      </p>

      <div className="mt-2 flex shrink-0 gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && void send()}
          placeholder="Ask your coach…"
          disabled={loading || !cid}
          className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={loading || !cid || !input.trim()}
          className="rounded-xl bg-emerald-600 px-6 py-3 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
