"use client";

import { useMemo } from "react";
import {
  Target,
  TrendingDown,
  CalendarClock,
  Snowflake,
  Sparkles,
  Heart,
  Home,
  Gem,
} from "lucide-react";
import Link from "next/link";

type ServiceLine = {
  key: string;
  label: string;
  target: number;
  won: number;
  open: number;
  progress: number;            // 0..1
};

type SavingsGoalLite = {
  id: string;
  name: string;
  target_usd: number;
  current_usd: number;
  target_date: string | null;
  emoji: string | null;
  accent: string | null;
};

type Props = {
  revenueYtd: number;
  revenueTarget: number;
  debtPaidOff: number;
  debtBaseline: number;
  debtTotal: number;
  hasFinanceData: boolean;
  serviceLines: ServiceLine[];
  daysToFulltime: number;
  savingsGoals: SavingsGoalLite[];
};

const TZ = "America/New_York";

function fmtUsd(n: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    notation: opts.compact ? "compact" : "standard",
    maximumFractionDigits: opts.compact ? 1 : 0,
  });
}

function dayOfYearNow(): number {
  const start = new Date(new Date().getFullYear(), 0, 1).getTime();
  return Math.max(1, Math.round((Date.now() - start) / 86400000));
}

export function GoalsView({
  revenueYtd,
  revenueTarget,
  debtPaidOff,
  debtBaseline,
  debtTotal,
  hasFinanceData,
  serviceLines,
  daysToFulltime,
  savingsGoals,
}: Props) {
  const revenuePct = Math.min(1, revenueYtd / revenueTarget);
  const revenueRemaining = Math.max(0, revenueTarget - revenueYtd);
  const debtPct = debtBaseline > 0 ? Math.max(0, Math.min(1, debtPaidOff / debtBaseline)) : 0;

  const today = useMemo(() => {
    return new Date().toLocaleDateString("en-US", {
      timeZone: TZ,
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, []);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Target className="size-7" /> Goals 2026
          </h1>
          <p className="text-zinc-400">
            Day {dayOfYearNow()} of 365 · {today}
          </p>
        </div>
        <p className="text-xs text-zinc-500 italic">
          &quot;Debt free. House. Ring.&quot; 🎄
        </p>
      </div>

      {/* PRIMARY THREE — the ones that matter most */}
      <div className="space-y-4">
        <BigGoal
          icon={Sparkles}
          label="$500K revenue"
          accent="from-amber-400 via-pink-500 to-indigo-500"
          progress={revenuePct}
          headline={fmtUsd(revenueYtd)}
          subhead={`of ${fmtUsd(revenueTarget, { compact: true })} · ${(revenuePct * 100).toFixed(1)}%`}
          right={`${fmtUsd(revenueRemaining, { compact: true })} to go`}
          source={
            <Link href="/business" className="text-indigo-300 hover:underline">
              from GoHighLevel →
            </Link>
          }
        />

        <BigGoal
          icon={TrendingDown}
          label="$55K debt-free"
          accent="from-emerald-500 via-amber-400 to-rose-500"
          progress={debtPct}
          headline={fmtUsd(debtPaidOff)}
          subhead={
            hasFinanceData
              ? `paid off · ${fmtUsd(debtTotal, { compact: true })} remaining`
              : "Connect Plaid to track in real time"
          }
          right={`${(debtPct * 100).toFixed(1)}%`}
          source={
            hasFinanceData ? (
              <Link href="/finance" className="text-indigo-300 hover:underline">
                from Plaid →
              </Link>
            ) : (
              <Link href="/integrations" className="text-indigo-300 hover:underline">
                Connect bank →
              </Link>
            )
          }
        />

        <BigGoal
          icon={CalendarClock}
          label="Full-time on YLL by Jan 1, 2027"
          accent="from-purple-500 via-indigo-500 to-cyan-400"
          progress={Math.max(0, 1 - daysToFulltime / 365)}
          headline={`${daysToFulltime} days`}
          subhead={daysToFulltime === 0 ? "Time's up — you're either there or you aren't" : "remaining until full-time YLL"}
          right={daysToFulltime <= 90 ? "Final stretch" : `${Math.round(daysToFulltime / 7)} weeks`}
          source={null}
        />
      </div>

      {/* SECONDARY — service line targets, sourced from GHL pipelines */}
      <h2 className="text-sm font-bold mt-8 mb-3 text-zinc-300 uppercase tracking-wider">
        Service line targets (won + open YTD)
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {serviceLines.map((sl) => {
          const Icon =
            sl.key === "holiday" ? Snowflake : sl.key === "permanent" ? Home : Heart;
          return (
            <SecondaryGoal
              key={sl.key}
              icon={Icon}
              label={sl.label}
              progress={sl.progress}
              count={sl.won}
              target={sl.target}
              extra={`${sl.open} open in pipeline`}
            />
          );
        })}
      </div>

      {/* TERTIARY — savings / personal */}
      <h2 className="text-sm font-bold mt-8 mb-3 text-zinc-300 uppercase tracking-wider">
        Personal milestones
      </h2>
      {savingsGoals.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <PlaceholderGoal
            icon={Home}
            label="House down payment"
            tip="Add a savings goal in /finance to track this here."
          />
          <PlaceholderGoal
            icon={Gem}
            label="Engagement ring"
            tip="Add a savings goal in /finance to track this here."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {savingsGoals.map((g) => (
            <SavingsCard key={g.id} goal={g} />
          ))}
        </div>
      )}
      <p className="text-[11px] text-zinc-500 mt-2 ml-1">
        <Link href="/finance" className="hover:text-zinc-300">
          Manage savings goals on /finance →
        </Link>
      </p>
    </div>
  );
}

function SavingsCard({ goal }: { goal: SavingsGoalLite }) {
  const target = Number(goal.target_usd) || 0;
  const current = Number(goal.current_usd) || 0;
  const pct = target > 0 ? Math.max(0, Math.min(1, current / target)) : 0;
  const remaining = Math.max(0, target - current);
  const accent =
    goal.accent === "amber"
      ? "from-amber-400 via-orange-500 to-rose-500"
      : goal.accent === "rose"
      ? "from-rose-500 via-pink-500 to-purple-500"
      : goal.accent === "emerald"
      ? "from-emerald-500 via-cyan-500 to-blue-500"
      : goal.accent === "purple"
      ? "from-purple-500 via-fuchsia-500 to-pink-500"
      : goal.accent === "cyan"
      ? "from-cyan-400 via-sky-500 to-indigo-500"
      : "from-indigo-500 via-purple-500 to-pink-500";

  return (
    <div className="glass rounded-2xl p-4 border border-white/10">
      <div className="flex items-center gap-2 text-xs text-zinc-300 mb-2">
        <span className="text-base leading-none">{goal.emoji ?? "💰"}</span>
        <span className="truncate">{goal.name}</span>
      </div>
      <div className="text-2xl font-bold">
        ${current.toLocaleString("en-US", { maximumFractionDigits: 0 })}
        <span className="text-zinc-500 font-normal text-base">
          {" "}
          / ${target.toLocaleString("en-US", { maximumFractionDigits: 0 })}
        </span>
      </div>
      <div className="text-[11px] text-zinc-400 mb-2">
        {current >= target
          ? `🎉 ${(pct * 100).toFixed(0)}% — funded`
          : `${(pct * 100).toFixed(0)}% · $${remaining.toLocaleString("en-US", {
              maximumFractionDigits: 0,
            })} to go`}
        {goal.target_date ? ` · target ${goal.target_date}` : ""}
      </div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${accent}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}

function BigGoal({
  icon: Icon,
  label,
  accent,
  progress,
  headline,
  subhead,
  right,
  source,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  accent: string;                            // gradient classes
  progress: number;                          // 0..1
  headline: string;
  subhead: string;
  right: string;
  source: React.ReactNode;
}) {
  return (
    <div className="glass-strong rounded-2xl p-6 border border-white/10">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div className="flex items-center gap-3">
          <div
            className={`size-10 rounded-xl bg-gradient-to-br ${accent} flex items-center justify-center text-white shadow-lg`}
          >
            <Icon className="size-5" />
          </div>
          <div>
            <div className="text-xs text-zinc-400 uppercase tracking-wider">{label}</div>
            <div className="text-3xl font-bold leading-tight">{headline}</div>
            <div className="text-xs text-zinc-400 mt-0.5">{subhead}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-zinc-500 mb-1">{right}</div>
          {source}
        </div>
      </div>

      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${accent} transition-all`}
          style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }}
        />
      </div>
    </div>
  );
}

function SecondaryGoal({
  icon: Icon,
  label,
  progress,
  count,
  target,
  extra,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  progress: number;
  count: number;
  target: number;
  extra: string;
}) {
  return (
    <div className="glass rounded-2xl p-4 border border-white/10">
      <div className="flex items-center gap-2 text-xs text-zinc-300 mb-2">
        <Icon className="size-4" />
        {label}
      </div>
      <div className="text-2xl font-bold">
        {count}
        <span className="text-zinc-500 font-normal text-base"> / {target}</span>
      </div>
      <div className="text-[11px] text-zinc-400 mb-2">{extra}</div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full bg-indigo-400/70"
          style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }}
        />
      </div>
    </div>
  );
}

function PlaceholderGoal({
  icon: Icon,
  label,
  tip,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tip: string;
}) {
  return (
    <div className="glass rounded-2xl p-4 border-2 border-dashed border-white/10">
      <div className="flex items-center gap-2 text-xs text-zinc-400 mb-2">
        <Icon className="size-4" />
        {label}
      </div>
      <div className="text-zinc-500 text-xs">{tip}</div>
    </div>
  );
}
