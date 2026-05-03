"use client";

import { useState, useRef, useEffect, FormEvent } from "react";
import { Send, Mic, MicOff, Camera, Paperclip, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { ToolCallChip, isToolCallArray, type ToolCallRecord } from "@/components/tool-call-chip";

type ChatMessage = {
  id: string;
  role: string;
  content: string;
  channel?: string | null;
  attachments?: unknown;
  created_at: string;
};

type Capture = {
  id: string;
  title: string | null;
  source: string;
  category: string | null;
  created_at: string;
};

type Memory = { subject: string; fact: string };

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

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function ChatView({ initialMessages, recentCaptures, memories }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [pendingImage, setPendingImage] = useState<{
    dataUrl: string;
    mediaType: string;
    fileName: string;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  async function sendMessage(
    text: string,
    image?: { dataUrl: string; mediaType: string }
  ) {
    const trimmed = text.trim();
    if (!trimmed && !image) return;
    if (sending) return;

    setSending(true);
    const optimisticContent = trimmed || (image ? "(image)" : "");
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: optimisticContent,
      channel: "web",
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    setInput("");
    setPendingImage(null);

    try {
      const attachments = image
        ? [{ type: "image", mediaType: image.mediaType, data: image.dataUrl }]
        : [];

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: trimmed, attachments }),
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
        attachments: Array.isArray(data.tool_calls) && data.tool_calls.length > 0 ? data.tool_calls : undefined,
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
    sendMessage(
      input,
      pendingImage ? { dataUrl: pendingImage.dataUrl, mediaType: pendingImage.mediaType } : undefined
    );
  }

  function toggleVoice() {
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }
    const SR = getSpeechRecognition();
    if (!SR) {
      toast.error("Voice not supported in this browser. Try Chrome, Edge, or Safari.");
      return;
    }
    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join(" ");
      setInput(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = (e) => {
      setListening(false);
      if (e.error !== "no-speech") {
        toast.error(`Voice error: ${e.error}`);
      }
    };
    recognition.start();
    recognitionRef.current = recognition;
    setListening(true);
  }

  function pickImage() {
    fileInputRef.current?.click();
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting same file
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image too large (max 5MB)");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Only image files supported right now");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPendingImage({
        dataUrl: reader.result as string,
        mediaType: file.type,
        fileName: file.name,
      });
    };
    reader.onerror = () => toast.error("Couldn't read file");
    reader.readAsDataURL(file);
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
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4">
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

        {/* Pending image preview */}
        {pendingImage && (
          <div className="border-t border-white/10 p-3 flex items-center gap-3 bg-white/5">
            <img
              src={pendingImage.dataUrl}
              alt={pendingImage.fileName}
              className="size-12 rounded object-cover border border-white/10"
            />
            <div className="flex-1 text-xs">
              <div className="font-semibold truncate">{pendingImage.fileName}</div>
              <div className="text-zinc-400">Image ready · will send with your message</div>
            </div>
            <button
              onClick={() => setPendingImage(null)}
              className="size-7 hover:bg-white/10 rounded-full flex items-center justify-center"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        {/* Input */}
        <div className="border-t border-white/10 p-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onFileChange}
          />
          <form onSubmit={onSubmit}>
            <div className="glass rounded-2xl flex items-center gap-2 p-2">
              <button
                type="button"
                onClick={pickImage}
                disabled={sending}
                className="size-10 rounded-full hover:bg-white/10 flex items-center justify-center"
                title="Attach image"
              >
                <Camera className="size-4" />
              </button>
              <button
                type="button"
                disabled
                className="size-10 rounded-full hover:bg-white/10 flex items-center justify-center"
                title="PDF (coming soon)"
              >
                <Paperclip className="size-4 opacity-50" />
              </button>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  pendingImage
                    ? "Add a caption (optional)..."
                    : "Type a message — or capture an idea, task, reminder..."
                }
                className="flex-1 bg-transparent text-sm placeholder-zinc-500 focus:outline-none px-2"
                disabled={sending}
              />
              <button
                type="button"
                onClick={toggleVoice}
                disabled={sending}
                className={
                  listening
                    ? "size-10 rounded-full bg-red-500 flex items-center justify-center text-white animate-pulse"
                    : "size-10 rounded-full bg-red-500/20 hover:bg-red-500/30 flex items-center justify-center"
                }
                title={listening ? "Stop listening" : "Voice message"}
              >
                {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              </button>
              <button
                type="submit"
                disabled={sending || (!input.trim() && !pendingImage)}
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
              <span>🎤 Voice (web)</span>
              <span className="text-green-400">● Active</span>
            </li>
            <li className="flex justify-between">
              <span>📷 Image</span>
              <span className="text-green-400">● Active</span>
            </li>
            <li className="flex justify-between">
              <span>📱 WhatsApp</span>
              <span className="text-zinc-500">○ Phase 3</span>
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

  const toolCalls: ToolCallRecord[] = isToolCallArray(message.attachments)
    ? (message.attachments as ToolCallRecord[])
    : [];

  return (
    <div className="flex gap-3 items-start">
      <div className="brand-gradient size-9 rounded-full flex items-center justify-center text-white text-xs font-bold">
        B
      </div>
      <div className="max-w-2xl flex-1">
        <div className="glass rounded-2xl rounded-tl-sm p-3 text-sm whitespace-pre-wrap">
          {message.content}
        </div>
        {toolCalls.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {toolCalls.map((c, i) => (
              <ToolCallChip key={i} call={c} />
            ))}
          </div>
        )}
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
