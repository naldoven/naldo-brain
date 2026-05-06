"use client";

import { useState, useTransition, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, X, Trash2, PiggyBank, Pencil } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

export type SavingsGoal = {
  id: string;
  name: string;
  target_usd: number;
  current_usd: number;
  target_date: string | null;
  emoji: string | null;
  accent: string | null;
  archived: boolean;
  completed_at: string | null;
};

type Props = {
  goals: SavingsGoal[];
};

const ACCENTS: Array<{ key: SavingsGoal["accent"]; from: string; via: string; to: string }> = [
  { key: "indigo", from: "from-indigo-500", via: "via-purple-500", to: "to-pink-500" },
  { key: "amber", from: "from-amber-400", via: "via-orange-500", to: "to-rose-500" },
  { key: "rose", from: "from-rose-500", via: "via-pink-500", to: "to-purple-500" },
  { key: "emerald", from: "from-emerald-500", via: "via-cyan-500", to: "to-blue-500" },
  { key: "purple", from: "from-purple-500", via: "via-fuchsia-500", to: "to-pink-500" },
  { key: "cyan", from: "from-cyan-400", via: "via-sky-500", to: "to-indigo-500" },
];

function gradientFor(accent: string | null): string {
  const a = ACCENTS.find((x) => x.key === accent) ?? ACCENTS[0];
  return `${a.from} ${a.via} ${a.to}`;
}

function fmtUsd(n: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    notation: opts.compact ? "compact" : "standard",
    maximumFractionDigits: opts.compact ? 1 : 0,
  });
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(`${s}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function SavingsGoals({ goals }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<SavingsGoal | null>(null);
  const [updatingBalance, setUpdatingBalance] = useState<SavingsGoal | null>(null);

  async function deleteGoal(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    const { error } = await supabase.from("savings_goals").delete().eq("id", id);
    if (error) {
      toast.error(`Failed to delete: ${error.message}`);
      return;
    }
    toast.success("Deleted");
    startTransition(() => router.refresh());
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-sm flex items-center gap-2">
          <PiggyBank className="size-4" /> Savings goals
        </h3>
        <button
          onClick={() => setShowCreate(true)}
          className="text-[11px] px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white flex items-center gap-1.5"
        >
          <Plus className="size-3" /> Add goal
        </button>
      </div>

      {goals.length === 0 ? (
        <div className="glass rounded-2xl p-6 text-center border border-dashed border-white/10">
          <PiggyBank className="size-8 text-zinc-500 mx-auto mb-2" />
          <p className="text-sm text-zinc-400 mb-3">
            Track savings you&apos;re building — house down payment, ring, anything else.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="brand-gradient rounded-full px-4 py-1.5 text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Plus className="size-3" /> Create your first
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {goals.map((g) => {
            const target = Number(g.target_usd) || 0;
            const current = Number(g.current_usd) || 0;
            const pct = target > 0 ? Math.max(0, Math.min(1, current / target)) : 0;
            const remaining = Math.max(0, target - current);
            const isComplete = current >= target;
            return (
              <div
                key={g.id}
                className="glass-strong rounded-2xl p-4 border border-white/10"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xl shrink-0">{g.emoji ?? "💰"}</span>
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{g.name}</div>
                      <div className="text-[10px] text-zinc-500">
                        {g.target_date ? `target ${fmtDate(g.target_date)}` : "no target date"}
                        {isComplete && " · 🎉 funded"}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-0.5 shrink-0">
                    <button
                      onClick={() => setEditing(g)}
                      className="size-6 rounded hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white"
                      title="Edit"
                    >
                      <Pencil className="size-3" />
                    </button>
                    <button
                      onClick={() => deleteGoal(g.id, g.name)}
                      className="size-6 rounded hover:bg-rose-500/20 flex items-center justify-center text-zinc-400 hover:text-rose-300"
                      title="Delete"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>

                <div className="flex items-baseline justify-between mb-1">
                  <div className="font-bold text-lg">{fmtUsd(current)}</div>
                  <div className="text-[10px] text-zinc-400">
                    of {fmtUsd(target, { compact: true })}
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden mb-2">
                  <div
                    className={`h-full bg-gradient-to-r ${gradientFor(g.accent)}`}
                    style={{ width: `${pct * 100}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-zinc-500">
                    {isComplete
                      ? `+${fmtUsd(current - target, { compact: true })} above target`
                      : `${fmtUsd(remaining, { compact: true })} to go · ${(pct * 100).toFixed(0)}%`}
                  </span>
                  <button
                    onClick={() => setUpdatingBalance(g)}
                    disabled={pending}
                    className="text-indigo-300 hover:text-indigo-200 underline"
                  >
                    Update balance
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <GoalModal
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            startTransition(() => router.refresh());
          }}
        />
      )}
      {editing && (
        <GoalModal
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            startTransition(() => router.refresh());
          }}
        />
      )}
      {updatingBalance && (
        <UpdateBalanceModal
          goal={updatingBalance}
          onClose={() => setUpdatingBalance(null)}
          onSaved={() => {
            setUpdatingBalance(null);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </div>
  );
}

// ---------- modals --------------------------------------------------------

function GoalModal({
  existing,
  onClose,
  onSaved,
}: {
  existing?: SavingsGoal;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [name, setName] = useState(existing?.name ?? "");
  const [target, setTarget] = useState(
    existing ? String(existing.target_usd) : ""
  );
  const [current, setCurrent] = useState(
    existing ? String(existing.current_usd) : "0"
  );
  const [targetDate, setTargetDate] = useState(existing?.target_date ?? "");
  const [emoji, setEmoji] = useState(existing?.emoji ?? "💰");
  const [accent, setAccent] = useState<SavingsGoal["accent"]>(
    existing?.accent ?? "indigo"
  );
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !target || submitting) return;
    setSubmitting(true);

    const targetNum = Number(target);
    const currentNum = Number(current) || 0;
    if (!Number.isFinite(targetNum) || targetNum <= 0) {
      toast.error("Target must be a positive number");
      setSubmitting(false);
      return;
    }

    const payload: Record<string, unknown> = {
      name: name.trim(),
      target_usd: targetNum,
      current_usd: currentNum,
      target_date: targetDate || null,
      emoji: emoji || null,
      accent: accent ?? "indigo",
      updated_at: new Date().toISOString(),
      completed_at: currentNum >= targetNum ? new Date().toISOString() : null,
    };

    if (existing) {
      const { error } = await supabase
        .from("savings_goals")
        .update(payload)
        .eq("id", existing.id);
      setSubmitting(false);
      if (error) {
        toast.error(`Save failed: ${error.message}`);
        return;
      }
      toast.success("Updated");
    } else {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) {
        toast.error("Not signed in");
        setSubmitting(false);
        return;
      }
      payload.user_id = userId;
      const { error } = await supabase.from("savings_goals").insert(payload);
      setSubmitting(false);
      if (error) {
        toast.error(`Create failed: ${error.message}`);
        return;
      }
      toast.success("Created");
    }
    onSaved();
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
          <h2 className="text-xl font-bold">
            {existing ? "Edit goal" : "New savings goal"}
          </h2>
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
            <label className="text-xs text-zinc-400 mb-1 block">Name *</label>
            <input
              autoFocus
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. House down payment"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Target *</label>
              <input
                type="number"
                step="100"
                min="1"
                required
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="50000"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Current</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder="0"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Target date</label>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Emoji</label>
              <input
                type="text"
                value={emoji}
                onChange={(e) => setEmoji(e.target.value.slice(0, 4))}
                placeholder="🏠"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-2 block">Color</label>
            <div className="flex gap-2 flex-wrap">
              {ACCENTS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setAccent(a.key)}
                  className={`size-8 rounded-full bg-gradient-to-r ${a.from} ${a.via} ${a.to} ring-2 ring-offset-2 ring-offset-zinc-900 transition-all ${
                    accent === a.key ? "ring-white" : "ring-transparent hover:ring-white/30"
                  }`}
                  aria-label={a.key ?? ""}
                />
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
            disabled={!name.trim() || !target || submitting}
            className="brand-gradient rounded-lg px-5 py-2 text-white font-semibold text-sm disabled:opacity-50 flex items-center gap-2"
          >
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            {existing ? "Save" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

function UpdateBalanceModal({
  goal,
  onClose,
  onSaved,
}: {
  goal: SavingsGoal;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [value, setValue] = useState(String(goal.current_usd ?? 0));
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
      toast.error("Enter a non-negative number");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase
      .from("savings_goals")
      .update({
        current_usd: num,
        completed_at:
          num >= Number(goal.target_usd) ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", goal.id);
    setSubmitting(false);
    if (error) {
      toast.error(`Save failed: ${error.message}`);
      return;
    }
    toast.success("Updated");
    onSaved();
  }

  const target = Number(goal.target_usd) || 0;
  const current = Number(value) || 0;
  const remaining = Math.max(0, target - current);

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="glass-strong rounded-2xl p-6 w-full max-w-sm"
      >
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            {goal.emoji ?? "💰"} {goal.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="size-8 hover:bg-white/10 rounded-full flex items-center justify-center"
          >
            <X className="size-4" />
          </button>
        </div>

        <label className="text-xs text-zinc-400 mb-1 block">New balance</label>
        <input
          autoFocus
          type="number"
          step="0.01"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 mb-3"
        />
        <div className="text-[11px] text-zinc-500 mb-4">
          Target {fmtUsd(target, { compact: true })} ·{" "}
          {remaining > 0
            ? `${fmtUsd(remaining, { compact: true })} to go`
            : "🎉 funded"}
        </div>

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 hover:bg-white/5 rounded-lg text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="brand-gradient rounded-lg px-5 py-2 text-white font-semibold text-sm disabled:opacity-50 flex items-center gap-2"
          >
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
