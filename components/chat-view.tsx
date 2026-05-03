"use client";

import { useState, useRef, useEffect, FormEvent } from "react";
import { Send, Mic, Camera, Paperclip, Sparkles } from "lucide-react";
import { toast } from "sonner";

type ChatMessage = {
  id: string;
  role: string;
  content: string;
  channel?: string | null;
  created_at: string;
};

type Capture = {
  id: string;
  title: string | null;
  source: string;
  category: string | null;
  created_at: string;
};

type Memory = {
  subject: string;
  fact: string;
};

type Props = {
  initialMessages: ChatMessage[];
  recentCaptures: Capture[];
  memories: Memory[];
};

const QUICK_PROMPTS = [
  "📊 What's my close rate?",
  "💰 Cash runway?",
  "📋 Today's plan",
  "🎯 Goals progress",
  "⚠ What am I avoiding?",
];

export function ChatView({ initialMessages, recentCaptures, memories }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: trimmed,
      channel: "web",
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    setInput("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json();
      const assistant: ChatMessage = {
        id: `assist-${Date.now()}`,
        role: "assistant",
        content: data.message,
        channel: "web",
        created_at: new Date().toISOString(),
      };
      setMessages((m) => [...m, assistant]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send";
      toast.error(msg);
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
    } finally {
      setSending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] gap-4">
      {/* Main chat panel */}
      <div className="flex-1 flex flex-col glass-strong rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="border-b border-white/10 p-4 flex items-center gap-3">
          <div className="brand-gradient size-10 rounded-full flex items-center justify-center text-white">
            <Sparkles className="size-4" />
          </div>
          <div className="flex-1">
            <h2 className="font-bold">Brain</h2>
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="size-2 rounded-full bg-green-400" />
              Online · Claude Sonnet 4.6 · Web
            </div>
          </div>
        </div>

        {/* Conversation */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-6 space-y-4"
        >
          {messages.length === 0 && (
            <div className="text-center text-zinc-400 py-12">
              <div className="text-3xl mb-2">👋</div>
              <p className="text-sm">
                Say hi to Brain, capture an idea, or ask about your metrics.
              </p>
            </div>
          )}

          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}

          {sending && (
            <div className="flex gap-3 items-start">
              <div className="brand-gradient size-9 rounded-full flex items-center justify-center text-white text-xs font-bold">
                B
              </div>
              <div className="glass rounded-2xl rounded-tl-sm p-3 text-sm text-zinc-400 italic">
                thinking...
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-white/10 p-4">
          <form onSubmit={onSubmit}>
            <div className="glass rounded-2xl flex items-center gap-2 p-2">
              <button
                type="button"
                className="size-10 rounded-full hover:bg-white/10 flex items-center justify-center"
                title="Attach image (coming soon)"
                disabled
              >
                <Camera className="size-4 opacity-50" />
              </button>
              <button
                type="button"
                className="size-10 rounded-full hover:bg-white/10 flex items-center justify-center"
                title="Attach PDF (coming soon)"
                disabled
              >
                <Paperclip className="size-4 opacity-50" />
              </button>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type a message — or capture an idea, task, reminder..."
                className="flex-1 bg-transparent text-sm placeholder-zinc-500 focus:outline-none px-2"
                disabled={sending}
              />
              <button
                type="button"
                className="size-10 rounded-full bg-red-500/20 hover:bg-red-500/30 flex items-center justify-center"
                title="Voice message (coming soon)"
                disabled
              >
                <Mic className="size-4 opacity-50" />
              </button>
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="px-5 py-2 brand-gradient rounded-full text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
              >
                <Send className="size-3.5" />
                Send
              </button>
            </div>
          </form>

          <div className="flex gap-2 mt-3 flex-wrap">
            {QUICK_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => sendMessage(p.replace(/^\S+\s/, ""))}
                disabled={sending}
                className="text-xs px-3 py-1.5 bg-white/5 rounded-full hover:bg-white/10 disabled:opacity-50"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right rail */}
      <div className="w-72 flex flex-col gap-4 overflow-y-auto">
        <div className="glass rounded-2xl p-4">
          <h3 className="font-bold text-sm mb-3">Recent Captures</h3>
          {recentCaptures.length === 0 ? (
            <p className="text-xs text-zinc-500">
              Nothing yet. Start chatting to capture ideas.
            </p>
          ) : (
            <ul className="space-y-2 text-xs">
              {recentCaptures.map((c) => (
                <li key={c.id} className="p-2 bg-white/5 rounded">
                  <div className="font-semibold truncate">{c.title || "(no title)"}</div>
                  <div className="text-zinc-400 mt-0.5">
                    {new Date(c.created_at).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    · {c.source}
                    {c.category ? ` · ${c.category}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="glass rounded-2xl p-4">
          <h3 className="font-bold text-sm mb-3">What Brain Remembers</h3>
          {memories.length === 0 ? (
            <p className="text-xs text-zinc-500">
              No memories saved yet. Tell Brain a preference or fact and it&apos;ll
              remember.
            </p>
          ) : (
            <ul className="space-y-1.5 text-xs text-zinc-300">
              {memories.map((m, i) => (
                <li key={i}>
                  • <span className="text-zinc-400">[{m.subject}]</span> {m.fact}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="glass rounded-2xl p-4">
          <h3 className="font-bold text-sm mb-3">Channels</h3>
          <ul className="space-y-1.5 text-xs">
            <li className="flex justify-between">
              <span>💬 Web chat</span>
              <span className="text-green-400">● Active</span>
            </li>
            <li className="flex justify-between">
              <span>📱 WhatsApp</span>
              <span className="text-zinc-500">○ Phase 2.5</span>
            </li>
            <li className="flex justify-between">
              <span>📧 memorae@yulelovelights.com</span>
              <span className="text-zinc-500">○ Phase 2.5</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex gap-3 items-start justify-end">
        <div className="max-w-md">
          <div className="brand-gradient rounded-2xl rounded-tr-sm p-3 text-white text-sm whitespace-pre-wrap">
            {message.content}
          </div>
          <div className="text-[10px] text-zinc-500 text-right mt-1">
            {formatTime(message.created_at)}
          </div>
        </div>
        <div className="size-9 rounded-full bg-gradient-to-br from-amber-400 to-red-500 flex items-center justify-center font-bold text-sm text-white">
          N
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 items-start">
      <div className="brand-gradient size-9 rounded-full flex items-center justify-center text-white text-xs font-bold">
        B
      </div>
      <div className="max-w-2xl">
        <div className="glass rounded-2xl rounded-tl-sm p-3 text-sm whitespace-pre-wrap">
          {message.content}
        </div>
        <div className="text-[10px] text-zinc-500 mt-1">
          {formatTime(message.created_at)}
        </div>
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
