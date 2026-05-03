"use client";

import { useState, useMemo, FormEvent } from "react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  isToday,
  format,
  addMonths,
  subMonths,
  parseISO,
} from "date-fns";
import { ChevronLeft, ChevronRight, Plus, Calendar as CalIcon, X, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

type CalEvent = {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  color: string | null;
  source: string;
};

type Props = { initialEvents: CalEvent[] };

const SOURCE_COLORS: Record<string, string> = {
  local: "#6366F1",   // indigo
  google: "#10B981",  // green
  jobber: "#F97316",  // orange
  ics: "#A855F7",     // purple
};

export function CalendarView({ initialEvents }: Props) {
  const [events, setEvents] = useState<CalEvent[]>(initialEvents);
  const [cursor, setCursor] = useState(new Date());
  const [showCreate, setShowCreate] = useState<{ defaultDate?: Date } | null>(null);
  const [editing, setEditing] = useState<CalEvent | null>(null);

  const now = new Date();

  // Generate 6-week grid covering the visible month (Mon-Sun)
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }); // Mon = 1
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of events) {
      const d = parseISO(e.starts_at);
      const key = format(d, "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    // Sort each day's events by starts_at
    map.forEach((arr) =>
      arr.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    );
    return map;
  }, [events]);

  const todaysEvents = eventsByDate.get(format(now, "yyyy-MM-dd")) ?? [];

  const upcoming = useMemo(() => {
    return [...events]
      .filter((e) => parseISO(e.starts_at) > now)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .slice(0, 5);
  }, [events, now]);

  function eventColor(e: CalEvent): string {
    return e.color || SOURCE_COLORS[e.source] || "#6366F1";
  }

  async function deleteEvent(id: string) {
    if (!confirm("Delete this event?")) return;
    const prev = events;
    setEvents((es) => es.filter((e) => e.id !== id));
    setEditing(null);
    const res = await fetch(`/api/calendar-events/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setEvents(prev);
      toast.error("Failed to delete");
    }
  }

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <CalIcon className="size-7" /> Calendar
          </h1>
          <p className="text-zinc-400">Local events for now. Google Calendar sync in a later phase.</p>
        </div>
        <button
          onClick={() => setShowCreate({ defaultDate: now })}
          className="brand-gradient rounded-full px-5 py-2 text-white text-sm font-semibold flex items-center gap-2"
        >
          <Plus className="size-4" /> New event
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Month grid */}
        <div className="glass-strong rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">{format(cursor, "MMMM yyyy")}</h2>
            <div className="flex gap-1 items-center">
              <button
                onClick={() => setCursor(new Date())}
                className="text-xs px-3 py-1 bg-white/5 rounded hover:bg-white/10"
              >
                Today
              </button>
              <button
                onClick={() => setCursor((d) => subMonths(d, 1))}
                className="size-8 rounded hover:bg-white/10 flex items-center justify-center"
                aria-label="Previous month"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                onClick={() => setCursor((d) => addMonths(d, 1))}
                className="size-8 rounded hover:bg-white/10 flex items-center justify-center"
                aria-label="Next month"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>

          {/* Day-of-week header (Mon-Sun) */}
          <div className="grid grid-cols-7 gap-2 mb-2 text-xs text-zinc-500">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="text-center">
                {d}
              </div>
            ))}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-7 gap-2">
            {days.map((d) => {
              const dayKey = format(d, "yyyy-MM-dd");
              const dayEvents = eventsByDate.get(dayKey) ?? [];
              const inMonth = isSameMonth(d, cursor);
              const isCurrent = isToday(d);

              return (
                <div
                  key={dayKey}
                  onClick={() => setShowCreate({ defaultDate: d })}
                  className={`aspect-[3/4] glass rounded-lg p-2 cursor-pointer hover:bg-white/8 transition-colors ${
                    isCurrent ? "ring-2 ring-indigo-500/60 bg-indigo-500/10" : ""
                  } ${!inMonth ? "opacity-40" : ""}`}
                >
                  <div
                    className={`text-xs ${
                      isCurrent ? "font-bold text-amber-300" : "text-zinc-400"
                    }`}
                  >
                    {format(d, "d")}
                  </div>
                  <div className="mt-1 space-y-1 overflow-hidden">
                    {dayEvents.slice(0, 3).map((e) => (
                      <button
                        key={e.id}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setEditing(e);
                        }}
                        className="w-full text-left text-[9px] px-1 py-0.5 rounded truncate"
                        style={{
                          backgroundColor: `${eventColor(e)}40`,
                          color: eventColor(e),
                        }}
                        title={e.title}
                      >
                        {!e.all_day && format(parseISO(e.starts_at), "h:mma").toLowerCase()}{" "}
                        {e.title}
                      </button>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-[9px] text-zinc-500 px-1">
                        +{dayEvents.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-4">
          <div className="glass-strong rounded-2xl p-5">
            <h3 className="font-bold text-lg">Today&apos;s events</h3>
            <div className="text-sm text-zinc-400 mb-4">
              {format(now, "MMMM d, yyyy")}
            </div>
            {todaysEvents.length === 0 ? (
              <div className="text-center py-6 text-xs text-zinc-500">
                No events today. Click any cell to add one.
              </div>
            ) : (
              <div className="space-y-2">
                {todaysEvents.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setEditing(e)}
                    className="w-full text-left rounded-lg p-3 border-l-4 hover:bg-white/5"
                    style={{
                      borderLeftColor: eventColor(e),
                      backgroundColor: `${eventColor(e)}10`,
                    }}
                  >
                    <div className="text-xs text-zinc-400">
                      {e.all_day
                        ? "All day"
                        : format(parseISO(e.starts_at), "h:mm a") +
                          (e.ends_at
                            ? ` – ${format(parseISO(e.ends_at), "h:mm a")}`
                            : "")}
                    </div>
                    <div className="font-semibold text-sm mt-1">{e.title}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="glass rounded-2xl p-5">
            <h3 className="font-bold text-sm mb-3">Upcoming</h3>
            {upcoming.length === 0 ? (
              <p className="text-xs text-zinc-500">Nothing scheduled.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {upcoming.map((e) => (
                  <li
                    key={e.id}
                    className="flex justify-between items-center cursor-pointer hover:bg-white/5 p-2 rounded"
                    onClick={() => setEditing(e)}
                  >
                    <span className="truncate flex-1">
                      <span className="text-zinc-400">
                        {format(parseISO(e.starts_at), "MMM d")} ·{" "}
                      </span>
                      {e.title}
                    </span>
                    <span className="text-zinc-500 ml-2">
                      {Math.ceil(
                        (parseISO(e.starts_at).getTime() - now.getTime()) /
                          (24 * 60 * 60 * 1000)
                      )}
                      d
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {showCreate && (
        <CreateEventModal
          defaultDate={showCreate.defaultDate}
          onClose={() => setShowCreate(null)}
          onCreated={(e) => {
            setEvents((es) => [...es, e]);
            setShowCreate(null);
          }}
        />
      )}

      {editing && (
        <EditEventModal
          event={editing}
          onClose={() => setEditing(null)}
          onUpdated={(e) =>
            setEvents((es) => es.map((x) => (x.id === e.id ? e : x)))
          }
          onDelete={() => deleteEvent(editing.id)}
        />
      )}
    </div>
  );
}

function CreateEventModal({
  defaultDate = new Date(),
  onClose,
  onCreated,
}: {
  defaultDate?: Date;
  onClose: () => void;
  onCreated: (e: CalEvent) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(format(defaultDate, "yyyy-MM-dd"));
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [allDay, setAllDay] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);

    const startsAt = new Date(`${date}T${allDay ? "00:00" : start}:00`);
    const endsAt = allDay
      ? new Date(`${date}T23:59:59`)
      : new Date(`${date}T${end}:00`);

    try {
      const res = await fetch("/api/calendar-events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          all_day: allDay,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      toast.success("Event created");
      onCreated(data.event);
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
        className="glass-strong rounded-2xl p-6 w-full max-w-md"
      >
        <h2 className="text-xl font-bold mb-4">New event</h2>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Title *</label>
            <input
              autoFocus
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Crew standup"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
            />
            All day
          </label>
          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Start</label>
                <input
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">End</label>
                <input
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          )}
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
            disabled={!title.trim() || submitting}
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

function EditEventModal({
  event,
  onClose,
  onUpdated,
  onDelete,
}: {
  event: CalEvent;
  onClose: () => void;
  onUpdated: (e: CalEvent) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/calendar-events/${event.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      toast.success("Updated");
      onUpdated(data.event);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Update failed";
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
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="glass-strong rounded-2xl p-6 w-full max-w-md"
      >
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-xl font-bold">Edit event</h2>
          <button
            type="button"
            onClick={onClose}
            className="size-8 hover:bg-white/10 rounded-full flex items-center justify-center"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="text-xs text-zinc-400 mb-4">
          {format(parseISO(event.starts_at), "PPpp")}
          {event.ends_at && ` – ${format(parseISO(event.ends_at), "p")}`}
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Title</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="mt-6 flex gap-2 justify-between items-center">
          <button
            type="button"
            onClick={onDelete}
            className="px-3 py-2 hover:bg-red-500/20 text-red-400 rounded-lg text-sm flex items-center gap-2"
          >
            <Trash2 className="size-3.5" />
            Delete
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 hover:bg-white/5 rounded-lg text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || submitting}
              className="brand-gradient rounded-lg px-5 py-2 text-white font-semibold text-sm disabled:opacity-50 flex items-center gap-2"
            >
              {submitting && <Loader2 className="size-3.5 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
