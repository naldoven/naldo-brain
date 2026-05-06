"use client";

import { useState, useTransition, FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Plus,
  RotateCcw,
  Loader2,
  Flame,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

type Avoidance = {
  id: string;
  title: string;
  description: string | null;
  flagged: boolean;
  flagged_at: string | null;
  last_touched_at: string;
  escalated_at: string | null;
  completed: boolean;
  completed_at: string | null;
  created_at: string;
};

type Props = {
  active: Avoidance[];
  recentlyResolved: Avoidance[];
  resolvedThisWeek: number;
};

const TZ = "America/New_York";

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / 86400000);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
  });
}

export function AvoidanceView({
  active,
  recentlyResolved,
  resolvedThisWeek,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const flagged = active.filter((a) => a.flagged);
  const watching = active.filter((a) => !a.flagged);
  const oldestFlagDays =
    flagged.length > 0
      ? Math.max(...flagged.map((a) => daysSince(a.flagged_at) ?? 0))
      : 0;

  async function resolve(id: string) {
    setBusyId(id);
    const { error } = await supabase
      .from("avoidance_items")
      .update({
        completed: true,
        completed_at: new Date().toISOString(),
      })
      .eq("id", id);
    setBusyId(null);
    if (error) {
      toast.error("Failed to resolve");
      return;
    }
    toast.success("Resolved");
    startTransition(() => router.refresh());
  }

  async function touch(id: string) {
    setBusyId(id);
    const { error } = await supabase
      .from("avoidance_items")
      .update({
        flagged: false,
        flagged_at: null,
        last_touched_at: new Date().toISOString(),
      })
      .eq("id", id);
    setBusyId(null);
    if (error) {
      toast.error("Failed to update");
      return;
    }
    toast.success("Snoozed for 7 days");
    startTransition(() => router.refresh());
  }

  async function unresolve(id: string) {
    setBusyId(id);
    const { error } = await supabase
      .from("avoidance_items")
      .update({
        completed: false,
        completed_at: null,
      })
      .eq("id", id);
    setBusyId(null);
    if (error) {
      toast.error("Failed to undo");
      return;
    }
    toast.success("Re-opened");
    startTransition(() => router.refresh());
  }

  return (
    <div>
      <div className="flex justify-between items-start mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <AlertTriangle className="size-7 text-amber-400" /> Avoidance Radar
          </h1>
          <p className="text-zinc-400">
            Things you keep pushing off. Brain auto-flags anything you haven&apos;t touched in 7+ days.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="brand-gradient rounded-full px-5 py-2 text-white text-sm font-semibold flex items-center gap-2 shrink-0"
        >
          <Plus className="size-4" /> Flag something
        </button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat
          label="Currently flagged"
          value={flagged.length}
          accent={flagged.length > 0 ? "amber" : "zinc"}
          icon={Flame}
        />
        <Stat
          label="Watching"
          value={watching.length}
          accent="zinc"
          icon={AlertTriangle}
          sub="not yet at 7-day mark"
        />
        <Stat
          label="Oldest"
          value={oldestFlagDays > 0 ? `${oldestFlagDays}d` : "—"}
          accent={oldestFlagDays >= 14 ? "rose" : oldestFlagDays >= 7 ? "amber" : "zinc"}
          icon={Flame}
          sub="day flagged"
        />
        <Stat
          label="Resolved (7d)"
          value={resolvedThisWeek}
          accent={resolvedThisWeek > 0 ? "emerald" : "zinc"}
          icon={CheckCircle2}
        />
      </div>

      {/* Flagged list (the meat) */}
      {flagged.length === 0 && watching.length === 0 ? (
        <EmptyState onCreate={() => setShowCreate(true)} />
      ) : (
        <>
          {flagged.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-bold mb-3 uppercase tracking-wider text-amber-300 flex items-center gap-2">
                <Flame className="size-4" /> Flagged ({flagged.length})
              </h2>
              <div className="space-y-2">
                {flagged.map((a) => (
                  <ItemRow
                    key={a.id}
                    item={a}
                    flagged
                    busy={busyId === a.id || pending}
                    onResolve={() => resolve(a.id)}
                    onTouch={() => touch(a.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {watching.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-bold mb-3 uppercase tracking-wider text-zinc-400">
                Watching ({watching.length})
              </h2>
              <div className="space-y-2">
                {watching.map((a) => (
                  <ItemRow
                    key={a.id}
                    item={a}
                    flagged={false}
                    busy={busyId === a.id || pending}
                    onResolve={() => resolve(a.id)}
                    onTouch={() => touch(a.id)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Recently resolved */}
      {recentlyResolved.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-bold mb-3 uppercase tracking-wider text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="size-4" /> Resolved this week ({recentlyResolved.length})
          </h2>
          <div className="space-y-2">
            {recentlyResolved.map((a) => (
              <div
                key={a.id}
                className="glass rounded-xl p-3 flex items-center gap-3"
              >
                <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate line-through opacity-70">
                    {a.title}
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    Resolved {fmtDate(a.completed_at)}
                  </div>
                </div>
                <button
                  onClick={() => unresolve(a.id)}
                  disabled={busyId === a.id || pending}
                  className="text-[10px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white flex items-center gap-1 disabled:opacity-50"
                >
                  <RotateCcw className="size-3" /> Undo
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </div>
  );
}

// ---------- subcomponents -------------------------------------------------

function ItemRow({
  item,
  flagged,
  busy,
  onResolve,
  onTouch,
}: {
  item: Avoidance;
  flagged: boolean;
  busy: boolean;
  onResolve: () => void;
  onTouch: () => void;
}) {
  const flagDays = daysSince(item.flagged_at);
  const lastTouchedDays = daysSince(item.last_touched_at) ?? 0;
  const accent = flagged
    ? flagDays !== null && flagDays >= 14
      ? "border-rose-500/40 bg-rose-500/5"
      : "border-amber-500/40 bg-amber-500/5"
    : "border-white/10";

  return (
    <div className={`glass rounded-xl p-4 border ${accent}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">{item.title}</div>
          {item.description && (
            <div className="text-xs text-zinc-400 mt-1">{item.description}</div>
          )}
          <div className="text-[10px] text-zinc-500 mt-2">
            {flagged && flagDays !== null
              ? `Flagged ${flagDays === 0 ? "today" : `${flagDays}d ago`}`
              : `Last touched ${lastTouchedDays}d ago`}
            {flagged &&
              flagDays !== null &&
              flagDays >= 14 &&
              " · 🚨 escalating"}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <button
            onClick={onResolve}
            disabled={busy}
            className="text-[11px] px-2.5 py-1 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 disabled:opacity-50 flex items-center gap-1"
          >
            {busy ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3" />
            )}
            Done
          </button>
          <button
            onClick={onTouch}
            disabled={busy}
            className="text-[11px] px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-zinc-300 disabled:opacity-50 flex items-center gap-1"
          >
            <RotateCcw className="size-3" /> Snooze
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  accent: "amber" | "rose" | "emerald" | "zinc";
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const tone =
    accent === "amber"
      ? "from-amber-500/20 to-amber-500/5 border-amber-500/30"
      : accent === "rose"
      ? "from-rose-500/20 to-rose-500/5 border-rose-500/30"
      : accent === "emerald"
      ? "from-emerald-500/20 to-emerald-500/5 border-emerald-500/30"
      : "from-white/5 to-white/0 border-white/10";

  return (
    <div className={`glass rounded-2xl p-4 bg-gradient-to-br ${tone} border`}>
      <div className="flex items-center gap-2 text-xs text-zinc-300">
        <Icon className="size-4" />
        {label}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-[11px] text-zinc-400">{sub}</div>}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="glass-strong rounded-2xl p-8 text-center border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-transparent">
      <CheckCircle2 className="size-10 text-emerald-400 mx-auto mb-3" />
      <h3 className="font-bold text-lg mb-1">Nothing flagged</h3>
      <p className="text-sm text-zinc-400 mb-4">
        Brain hasn&apos;t caught you avoiding anything. Keep moving — or flag
        something on purpose so it stays on the radar.
      </p>
      <button
        onClick={onCreate}
        className="brand-gradient rounded-full px-5 py-2 text-white text-sm font-semibold inline-flex items-center gap-2"
      >
        <Plus className="size-4" /> Flag something manually
      </button>
    </div>
  );
}

function CreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const supabase = createClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      toast.error("Not signed in");
      setSubmitting(false);
      return;
    }
    const { error } = await supabase.from("avoidance_items").insert({
      user_id: userId,
      title: title.trim(),
      description: description.trim() || null,
      // Flag immediately so the user clearly sees it on the page.
      flagged: true,
      flagged_at: new Date().toISOString(),
    });
    setSubmitting(false);
    if (error) {
      toast.error(`Failed to flag: ${error.message}`);
      return;
    }
    toast.success("Flagged");
    onCreated();
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
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-xl font-bold">Flag something</h2>
          <button
            type="button"
            onClick={onClose}
            className="size-8 hover:bg-white/10 rounded-full flex items-center justify-center"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">What are you avoiding?</label>
            <input
              autoFocus
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="The thing you keep pushing off"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Why does it matter? (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="So future-you knows what was bugging current-you"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
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
            disabled={!title.trim() || submitting}
            className="brand-gradient rounded-lg px-5 py-2 text-white font-semibold text-sm disabled:opacity-50 flex items-center gap-2"
          >
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            Flag it
          </button>
        </div>
      </form>
    </div>
  );
}
