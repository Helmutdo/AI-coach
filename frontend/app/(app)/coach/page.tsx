"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import {
  getAIStatus,
  getCoachGreeting,
  getCoachHistory,
  postCoachChat,
  type ChatMessageRow,
} from "@/lib/api";
import { useAppStore } from "@/store/appStore";

const STORAGE_KEY = "garmin-ai-coach-conversation-id";

const SUGGESTIONS = [
  "How was my training this week?",
  "Am I ready to train hard tomorrow?",
  "What's my CTL/ATL/TSB right now?",
  "Suggest a session for today",
];

function sortByTime(a: ChatMessageRow, b: ChatMessageRow) {
  const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
  const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
  return ta - tb;
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function TriovAvatar({ size = "sm" }: { size?: "sm" | "lg" }) {
  const dim = size === "lg" ? "h-16 w-16 text-2xl" : "h-8 w-8 text-sm";
  return (
    <div
      className={`${dim} flex flex-shrink-0 items-center justify-center rounded-full font-black text-white`}
      style={{ background: "#1D9E75" }}
    >
      T
    </div>
  );
}

// ─── Typing indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="mb-3 flex items-start gap-3">
      <TriovAvatar />
      <div className="rounded-2xl rounded-tl-sm border border-gray-700/50 bg-gray-800/60 px-4 py-3">
        <div className="flex items-center gap-1.5">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="h-2 w-2 rounded-full bg-zinc-400 animate-bounce"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Rich message content ─────────────────────────────────────────────────────

function CoachMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
        strong: ({ children }) => (
          <strong className="font-semibold text-white">{children}</strong>
        ),
        ul: ({ children }) => (
          <ul className="mb-2 space-y-1 pl-1">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-2 space-y-1 pl-1 list-decimal list-inside">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="flex gap-2 text-gray-300 list-none">
            <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-teal-500" aria-hidden />
            <span className="flex-1">{children}</span>
          </li>
        ),
        code: ({ children }) => (
          <code className="rounded bg-zinc-700 px-1 py-0.5 text-xs font-mono text-zinc-200">
            {children}
          </code>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

// ─── Suggestion chips ─────────────────────────────────────────────────────────

function SuggestionChips({
  onSelect,
  visible,
}: {
  onSelect: (text: string) => void;
  visible: boolean;
}) {
  if (!visible) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
      {SUGGESTIONS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onSelect(s)}
          className="whitespace-nowrap rounded-full border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-all hover:border-gray-500 hover:bg-gray-800 cursor-pointer"
        >
          {s}
        </button>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CoachPage() {
  return (
    <Suspense>
      <CoachPageInner />
    </Suspense>
  );
}

function CoachPageInner() {
  const userId = useAppStore((s) => s.userId);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [cid, setCid] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [greeting, setGreeting] = useState<string | null>(null);
  const [greetingVisible, setGreetingVisible] = useState(false);
  const [input, setInput] = useState("");
  const [hasSent, setHasSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  // ── Init conversation ID + prefill ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    let id = sessionStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(STORAGE_KEY, id);
    }
    setCid(id);

    // Legacy sessionStorage prefill
    const prefill = sessionStorage.getItem("coach_prefill");
    if (prefill) {
      setInput(prefill);
      sessionStorage.removeItem("coach_prefill");
    }
  }, []);

  // ── Handle ?prompt= URL param ──
  useEffect(() => {
    const promptParam = searchParams.get("prompt");
    if (promptParam) {
      setInput(promptParam);
      // Remove param from URL without navigation
      const url = new URL(window.location.href);
      url.searchParams.delete("prompt");
      router.replace(url.pathname + (url.search || ""));
    }
  }, [searchParams, router]);

  // ── AI status ──
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

  // ── Load history ──
  const loadHistory = useCallback(async () => {
    if (!cid) return;
    setHistoryLoading(true);
    setErr(null);
    try {
      const rows = await getCoachHistory();
      const mine = rows.filter((r) => r.conversation_id === cid).sort(sortByTime);
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

  // ── Ephemeral greeting ──
  useEffect(() => {
    if (!aiReady || historyLoading || messages.length > 0) return;
    getCoachGreeting()
      .then(({ message }) => {
        setGreeting(message);
        setTimeout(() => setGreetingVisible(true), 50);
      })
      .catch(() => { /* optional — skip silently */ });
  }, [aiReady, historyLoading, messages.length]);

  // ── Auto-scroll ──
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, greeting]);

  // ── Send ──
  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || !cid || loading || !aiReady) return;
    setInput("");
    setHasSent(true);
    setGreeting(null);
    setLoading(true);
    setErr(null);
    try {
      await postCoachChat({ message: msg, conversation_id: cid });
      await loadHistory();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Chat failed");
    } finally {
      setLoading(false);
    }
  }

  // Chips visible when: input empty and (no messages sent OR at bottom of scroll)
  const showChips = !hasSent || (input === "" && messages.length > 0);

  // ── Not ready states ──
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
        <TriovAvatar size="lg" />
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Triov Coach</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Add an API key in Settings to start chatting. Your messages use the last 30 days of
            synced training data as context.
          </p>
        </div>
        <Link
          href="/settings"
          className="rounded-xl bg-emerald-600 px-6 py-3 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Open Settings
        </Link>
      </div>
    );
  }

  const showEmptyState = !historyLoading && messages.length === 0 && !greeting;
  const showGreeting = !historyLoading && messages.length === 0 && greeting != null;

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col gap-3">

      {/* ── Header ── */}
      <div className="flex shrink-0 items-center gap-3">
        <TriovAvatar />
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-100">Triov Coach</h1>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-xs text-zinc-500">Online</span>
          </div>
        </div>
      </div>

      {/* ── Error ── */}
      {err && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
          {err}
        </div>
      )}

      {/* ── Chat area ── */}
      <div
        ref={chatRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
      >
        {historyLoading && (
          <p className="text-center text-sm text-zinc-500">Loading history…</p>
        )}

        {/* Empty welcome state */}
        {showEmptyState && (
          <div className="flex h-full flex-col items-center justify-center gap-6 py-12 text-center">
            <TriovAvatar size="lg" />
            <div>
              <h2 className="text-lg font-semibold text-zinc-100">Your AI triathlon coach</h2>
              <p className="mt-2 max-w-sm text-sm text-zinc-400">
                I have access to your training data and can answer questions about your fitness,
                recovery, and race preparation.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => void send(p)}
                  className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Ephemeral greeting */}
        {showGreeting && (
          <div
            className="mb-3 flex items-start gap-3 transition-opacity duration-500"
            style={{ opacity: greetingVisible ? 1 : 0 }}
          >
            <TriovAvatar />
            <div className="mr-8 rounded-2xl rounded-tl-sm border border-gray-700/50 bg-gray-800/60 px-4 py-3 text-sm leading-relaxed text-gray-100">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Triov Coach
              </p>
              <CoachMessage content={greeting} />
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`mb-3 flex ${m.role === "user" ? "justify-end" : "items-start gap-3"}`}
          >
            {m.role === "assistant" && <TriovAvatar />}
            <div
              className={`text-sm leading-relaxed ${
                m.role === "user"
                  ? "ml-8 rounded-2xl rounded-tr-sm border border-teal-800/50 bg-teal-900/30 px-4 py-3 text-gray-100"
                  : "mr-8 rounded-2xl rounded-tl-sm border border-gray-700/50 bg-gray-800/60 px-4 py-3 text-gray-100"
              }`}
            >
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {m.role === "user" ? "You" : "Triov Coach"}
              </p>
              {m.role === "assistant" ? (
                <CoachMessage content={m.content} />
              ) : (
                <p className="whitespace-pre-wrap">{m.content}</p>
              )}
            </div>
          </div>
        ))}

        {loading && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* ── Input area ── */}
      <div className="shrink-0 space-y-2">
        <SuggestionChips
          visible={showChips && !loading}
          onSelect={(s) => void send(s)}
        />

        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && void send()}
            placeholder="Ask about your training, recovery, or race prep..."
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

        <p className="text-center text-xs text-zinc-600">
          Triov Coach uses your last 30 days of training data as context.
        </p>
      </div>
    </div>
  );
}
