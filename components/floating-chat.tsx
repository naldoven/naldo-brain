"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { MessageCircle, X, Send, Mic, Camera } from "lucide-react";
import { toast } from "sonner";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export function FloatingChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load recent messages once when opened
  useEffect(() => {
    if (!open || hasLoaded) return;
    setHasLoaded(true);
    fetch("/api/chat")
      .then((r) => r.json())
      .then((d) => {
        const last = (d.messages ?? []).slice(-10);
        setMessages(last);
      })
      .catch(() => {});
  }, [open, hasLoaded]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);

    const optimistic: Message = {
      id: `local-${Date.now()}`,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    setInput("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      const d = await res.json();
      setMessages((m) => [
        ...m,
        {
          id: `assist-${Date.now()}`,
          role: "assistant",
          content: d.message,
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Send failed";
      toast.error(msg);
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="brand-gradient rounded-full flex items-center justify-center text-white shadow-2xl shadow-indigo-500/50 relative hover:scale-105 transition-transform"
          aria-label="Open chat with Brain"
          style={{ width: 60, height: 60 }}
        >
          <MessageCircle className="size-6" />
        </button>
      )}

      {open && (
        <div
          className="glass-strong rounded-2xl flex flex-col overflow-hidden"
          style={{ width: 380, height: 540 }}
        >
          {/* Header */}
          <div className="border-b border-white/10 p-3 flex items-center gap-2">
            <div className="brand-gradient size-8 rounded-full flex items-center justify-center text-white font-bold text-xs">
              B
            </div>
            <div className="flex-1">
              <div className="font-bold text-sm">Brain</div>
              <div className="text-[10px] text-zinc-400 flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-green-400" />
                Online
              </div>
            </div>
            <Link
              href="/chat"
              className="text-[10px] text-indigo-300 hover:text-indigo-200"
              onClick={() => setOpen(false)}
            >
              Open full →
            </Link>
            <button
              onClick={() => setOpen(false)}
              className="size-6 hover:bg-white/10 rounded-full flex items-center justify-center"
              aria-label="Close chat"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && !sending && (
              <div className="text-center text-zinc-400 text-xs py-6">
                Say hi to Brain.
              </div>
            )}

            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex gap-2 items-start ${m.role === "user" ? "justify-end" : ""}`}
              >
                {m.role === "assistant" && (
                  <div className="brand-gradient size-7 rounded-full flex items-center justify-center text-white font-bold text-[10px]">
                    B
                  </div>
                )}
                <div
                  className={
                    m.role === "user"
                      ? "brand-gradient rounded-2xl rounded-tr-sm p-2.5 text-white text-xs max-w-[240px] whitespace-pre-wrap"
                      : "glass rounded-2xl rounded-tl-sm p-2.5 text-xs max-w-[260px] whitespace-pre-wrap"
                  }
                >
                  {m.content}
                </div>
                {m.role === "user" && (
                  <div className="size-7 rounded-full bg-gradient-to-br from-amber-400 to-red-500 flex items-center justify-center font-bold text-[10px] text-white">
                    N
                  </div>
                )}
              </div>
            ))}

            {sending && (
              <div className="flex gap-2 items-start">
                <div className="brand-gradient size-7 rounded-full flex items-center justify-center text-white font-bold text-[10px]">
                  B
                </div>
                <div className="glass rounded-2xl rounded-tl-sm p-2.5 text-xs italic text-zinc-400">
                  thinking...
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-white/10 p-2">
            <div className="glass rounded-full flex items-center gap-1 p-1.5">
              <button
                disabled
                className="size-7 hover:bg-white/10 rounded-full flex items-center justify-center"
                title="Image (Phase 2.5)"
              >
                <Camera className="size-3.5 opacity-50" />
              </button>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Message Brain..."
                disabled={sending}
                className="flex-1 bg-transparent text-xs placeholder-zinc-500 focus:outline-none px-1"
              />
              <button
                disabled
                className="size-7 bg-red-500/20 hover:bg-red-500/30 rounded-full flex items-center justify-center"
                title="Voice (Phase 2.5)"
              >
                <Mic className="size-3.5 opacity-50" />
              </button>
              <button
                onClick={send}
                disabled={sending || !input.trim()}
                className="size-7 brand-gradient rounded-full flex items-center justify-center text-white disabled:opacity-50"
              >
                <Send className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
