"use client";

import { useState, useMemo, FormEvent } from "react";
import { Bell, Search, Plus, Check, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Reminder = {
  id: string;
  title: string;
  description: string | null;
  fire_at: string | null;
  rrule: string | null;
  status: "active" | "completed" | "cancelled" | "snoozed";
  priority: "high" | "medium" | "low";
  channels: string[];
  tags: string[] | null;
  emoji: string | null;
  created_at: string;
};

type Props = {
  initialReminders: Reminder[];
};

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "fire", label: "Next fire" },
];

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "recurring", label: "Recurring" },
];

export function RemindersView({ initialReminders }: Props) {
  const [reminders, setReminders] = useState<Reminder[]>(initialReminders);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [filter, setFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);

  const stats = useMemo(() => {
    return {
      active: reminders.filter((r) => r.status === "active").length,
      recurring: reminders.filter((r) => !!r.rrule).length,
      completed: reminders.filter((r) => r.status === "completed").length,
      total: reminders.length,
    };
  }, [reminders]);

  const visible = useMemo(() => {
    let list = [...reminders];
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          (r.description ?? "").toLowerCase().includes(q)
      );
    }
    if (filter === "active") list = list.filter((r) => r.status === "active");
    else if (filter === "completed") list = list.filter((r) => r.status === "completed");
    else if (filter === "recurring") list = list.filter((r) => !!r.rrule);

    if (sort === "newest") list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    else if (sort === "oldest") list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    else if (sort === "fire") list.sort((a, b) => (a.fire_at ?? "z").localeCompare(b.fire_at ?? "z"));

    return list;
  }, [reminders, search, sort, filter]);

  async function complete(id: string) {
    const prev = reminders;
    setReminders((rs) =>
      rs.map((r) => (r.id === id ? { ...r, status: "completed" } : r))
    );
    const res = await fetch(`/api/reminders/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    if (!res.ok) {
      setReminders(prev);
      toast.error("Failed to mark complete");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this reminder?")) return;
    const prev = reminders;
    setReminders((rs) => rs.filter((r) => r.id !== id));
    const res = await fetch(`/api/reminders/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setReminders(prev);
      toast.error("Failed to delete");
    }
  }

  function onCreated(r: Reminder) {
    setReminders((rs) => [r, ...rs]);
    setShowCreate(false);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Bell className="size-7" /> Reminders
        </h1>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Active" value={stats.active} sub="Currently live" color="pink" />
        <StatCard label="Recurring" value={stats.recurring} sub="Repeating" color="blue" />
        <StatCard label="Completed" value={stats.completed} sub="Done successfully" color="cyan" />
        <StatCard label="Total" value={stats.total} sub="Created overall" color="pink" />
      </div>

      {/* Controls */}
      <div className="flex gap-3 mb-6 items-center flex-wrap">
        <div className="flex-1 min-w-[200px] glass rounded-full flex items-center px-4 py-2">
          <Search className="size-4 text-zinc-500 mr-2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search for a reminder"
            className="bg-transparent flex-1 text-sm placeholder-zinc-500 focus:outline-none"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="glass rounded-full px-4 py-2 text-sm focus:outline-none cursor-pointer"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} className="bg-zinc-900">
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="glass rounded-full px-4 py-2 text-sm focus:outline-none cursor-pointer"
        >
          {FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} className="bg-zinc-900">
              {o.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowCreate(true)}
          className="brand-gradient rounded-full px-6 py-2 text-white font-semibold text-sm flex items-center gap-2"
        >
          <Plus className="size-4" /> Create new reminder
        </button>
      </div>

      {/* List */}
      <div className="glass-strong rounded-2xl p-5 space-y-3">
        {visible.length === 0 && (
          <div className="text-center py-12">
            <Bell className="size-12 mx-auto text-zinc-600 mb-3" />
            <h3 className="font-bold mb-1">No reminders found</h3>
            <p className="text-xs text-zinc-500">
              {search || filter !== "all"
                ? "Try adjusting filters."
                : "Create your first reminder to get started."}
            </p>
          </div>
        )}

        {visible.map((r) => (
          <ReminderRow
            key={r.id}
            reminder={r}
            onComplete={() => complete(r.id)}
            onDelete={() => remove(r.id)}
          />
        ))}
      </div>

      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onCreated={onCreated} />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: number;
  sub: string;
  color: "pink" | "blue" | "cyan";
}) {
  const dot =
    color === "pink" ? "text-pink-400" : color === "blue" ? "text-blue-400" : "text-cyan-400";
  return (
    <div className="glass-strong rounded-2xl p-5 relative">
      <Bell className={`absolute top-3 right-3 size-4 ${dot}`} />
      <div className="text-4xl font-bold">{value}</div>
      <div className="font-semibold mt-2">{label}</div>
      <div className="text-xs text-zinc-400">{sub}</div>
    </div>
  );
}

function ReminderRow({
  reminder,
  onComplete,
  onDelete,
}: {
  reminder: Reminder;
  onComplete: () => void;
  onDelete: () => void;
}) {
  const isDone = reminder.status === "completed";
  const isRecurring = !!reminder.rrule;
  return (
    <div
      className={`flex items-center gap-4 p-3 rounded-lg hover:bg-white/8 ${
        isDone ? "bg-white/5 opacity-60" : "bg-white/5"
      }`}
    >
      <div className="size-10 rounded-full bg-pink-500/20 flex items-center justify-center text-lg">
        {reminder.emoji ?? "🔔"}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`font-semibold truncate ${isDone ? "line-through" : ""}`}>
          {reminder.title}
        </div>
        <div className="text-xs text-zinc-400 mt-0.5">
          {isRecurring ? "Recurring" : "One-time"}
          {reminder.fire_at && ` · ${new Date(reminder.fire_at).toLocaleString()}`}
          {reminder.channels.length > 0 && ` · ${reminder.channels.join(", ")}`}
        </div>
      </div>
      {isRecurring && (
        <span className="badge text-xs px-2 py-1 rounded-full bg-blue-500/20 text-blue-300">
          Recurring
        </span>
      )}
      <span
        className={`text-xs px-2 py-1 rounded-full ${
          isDone
            ? "bg-cyan-500/20 text-cyan-300"
            : reminder.status === "active"
            ? "bg-green-500/20 text-green-300"
            : "bg-zinc-500/20 text-zinc-300"
        }`}
      >
        {reminder.status}
      </span>
      {!isDone && (
        <button
          onClick={onComplete}
          className="size-8 hover:bg-green-500/20 rounded-full flex items-center justify-center text-green-400"
          title="Mark complete"
        >
          <Check className="size-4" />
        </button>
      )}
      <button
        onClick={onDelete}
        className="size-8 hover:bg-red-500/20 rounded-full flex items-center justify-center text-red-400"
        title="Delete"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

function CreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (r: Reminder) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fireAt, setFireAt] = useState("");
  const [recurrence, setRecurrence] = useState("once");
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [channels, setChannels] = useState<string[]>(["whatsapp"]);
  const [emoji, setEmoji] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function rruleFor(freq: string): string | null {
    if (freq === "daily") return "FREQ=DAILY";
    if (freq === "weekly") return "FREQ=WEEKLY";
    if (freq === "monthly") return "FREQ=MONTHLY";
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);

    const body: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim() || null,
      fire_at: fireAt ? new Date(fireAt).toISOString() : null,
      rrule: rruleFor(recurrence),
      priority,
      channels,
      emoji: emoji || null,
    };

    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      toast.success("Reminder created");
      onCreated(data.reminder);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Create failed";
      toast.error(msg);
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="glass-strong rounded-2xl p-6 w-full max-w-lg"
      >
        <h2 className="text-xl font-bold mb-4">Create new reminder</h2>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Title *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Pay rent"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional notes..."
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Date / time</label>
              <input
                type="datetime-local"
                value={fireAt}
                onChange={(e) => setFireAt(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Recurrence</label>
              <select
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none cursor-pointer"
              >
                <option value="once" className="bg-zinc-900">Once</option>
                <option value="daily" className="bg-zinc-900">Daily</option>
                <option value="weekly" className="bg-zinc-900">Weekly</option>
                <option value="monthly" className="bg-zinc-900">Monthly</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as "high" | "medium" | "low")}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none cursor-pointer"
              >
                <option value="high" className="bg-zinc-900">High</option>
                <option value="medium" className="bg-zinc-900">Medium</option>
                <option value="low" className="bg-zinc-900">Low</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Emoji</label>
              <input
                type="text"
                value={emoji}
                onChange={(e) => setEmoji(e.target.value.slice(0, 2))}
                placeholder="🔔"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Channels</label>
            <div className="flex gap-2 flex-wrap">
              {["whatsapp", "email", "sms", "push"].map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() =>
                    setChannels((cs) =>
                      cs.includes(ch) ? cs.filter((c) => c !== ch) : [...cs, ch]
                    )
                  }
                  className={`text-xs px-3 py-1 rounded-full ${
                    channels.includes(ch)
                      ? "brand-gradient text-white"
                      : "bg-white/5 text-zinc-400"
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 hover:bg-white/5 rounded-lg text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !title.trim()}
            className="brand-gradient rounded-lg px-5 py-2 text-white font-semibold text-sm disabled:opacity-50 flex items-center gap-2"
          >
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
