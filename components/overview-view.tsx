"use client";

import {
  Calendar,
  CheckSquare,
  Bell,
  AlertTriangle,
  MessageCircle,
  TrendingUp,
  TrendingDown,
  Footprints,
  Moon,
  Scale,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

type Event = {
  id: string;
  title: string;
  starts_at: string;
  all_day: boolean;
  color: string | null;
  source: string;
};

type Task = {
  id: string;
  title: string;
  priority: string | null;
  flagged: boolean;
  status: string | null;
};

type Reminder = {
  id: string;
  title: string;
  fire_at: string | null;
};

type Avoidance = {
  id: string;
  title: string;
  flagged_at: string;
};

type FinanceLite = {
  cashTotal: number;
  debtTotal: number;
  debtPaidOff: number;
  debtPctPaid: number;
  netLiquid: number;
  netFlow30d: number;
} | null;

type Props = {
  displayName: string;
  now: string;
  dayOfYear: number;
  daysLeftInYear: number;
  daysToFulltime: number;
  revenueYtd: number;
  revenueTarget: number;
  pipelineValue: number;
  finance: FinanceLite;
  debtBaseline: number;
  events: Event[];
  tasks: Task[];
  reminders: Reminder[];
  capturesThisWeek: number;
  avoidance: Avoidance[];
  health: {
    stepsToday: number;
    lastSleepHours: number | null;
    lastSleepAt: string | null;
    latestWeight: {
      value: number;
      unit: string | null;
      recorded_at: string;
    } | null;
  };
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

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

function greeting(now: Date): string {
  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hour: "numeric",
      hour12: false,
    }).format(now),
    10
  );
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Late night";
}

export function OverviewView(props: Props) {
  const {
    displayName,
    now,
    dayOfYear,
    daysLeftInYear,
    daysToFulltime,
    revenueYtd,
    revenueTarget,
    pipelineValue,
    finance,
    debtBaseline,
    events,
    tasks,
    reminders,
    capturesThisWeek,
    avoidance,
    health,
  } = props;

  const nowDate = new Date(now);
  const revenuePct = Math.min(1, revenueYtd / revenueTarget);
  const debtPct = finance ? finance.debtPctPaid : 0;

  return (
    <div>
      {/* Greeting */}
      <div className="mb-6">
        <h1 className="text-3xl md:text-4xl font-bold flex items-center gap-3 flex-wrap">
          <Sparkles className="size-7 text-amber-300" />
          {greeting(nowDate)}, {displayName}
        </h1>
        <p className="text-zinc-400 mt-1">
          {fmtDate(now)} · day {dayOfYear} of 365 · {daysLeftInYear} left in 2026 · {daysToFulltime} days to YLL full-time
        </p>
      </div>

      {/* Hero KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiTile
          label="Revenue YTD"
          value={fmtUsd(revenueYtd, { compact: true })}
          sub={`of ${fmtUsd(revenueTarget, { compact: true })} · ${(revenuePct * 100).toFixed(1)}%`}
          progress={revenuePct}
          gradient="from-amber-400 via-pink-500 to-indigo-500"
          href="/business"
        />
        <KpiTile
          label="Open pipeline"
          value={fmtUsd(pipelineValue, { compact: true })}
          sub={`${fmtNum(pipelineValue / Math.max(1, revenueTarget) * 100 | 0)}% of target in flight`}
          progress={Math.min(1, pipelineValue / revenueTarget)}
          gradient="from-indigo-400 via-purple-500 to-pink-500"
          href="/business"
        />
        <KpiTile
          label="Debt payoff"
          value={
            finance
              ? `${fmtUsd(finance.debtPaidOff, { compact: true })}`
              : "—"
          }
          sub={
            finance
              ? `of ${fmtUsd(debtBaseline, { compact: true })} · ${(debtPct * 100).toFixed(0)}%`
              : "Connect Plaid →"
          }
          progress={debtPct}
          gradient="from-emerald-500 via-amber-400 to-rose-500"
          href={finance ? "/finance" : "/integrations"}
        />
        <KpiTile
          label="Days to FT YLL"
          value={`${daysToFulltime}`}
          sub={
            daysToFulltime <= 90 ? "final stretch" : `${Math.round(daysToFulltime / 7)} weeks`
          }
          progress={Math.max(0, 1 - daysToFulltime / 365)}
          gradient="from-purple-500 via-indigo-500 to-cyan-400"
          href="/goals"
        />
      </div>

      {/* Today: events + tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <SectionCard
          title="Today's events"
          icon={Calendar}
          empty={events.length === 0 ? "No events today." : null}
          link={{ href: "/calendar", label: "Open calendar" }}
        >
          <div className="space-y-2">
            {events.map((e) => (
              <div
                key={e.id}
                className="flex items-baseline gap-3 p-2 rounded-lg hover:bg-white/5"
                style={{
                  borderLeft: `3px solid ${e.color ?? (e.source === "google" ? "#10B981" : "#6366F1")}`,
                }}
              >
                <div className="text-xs text-zinc-400 shrink-0 w-20">
                  {e.all_day ? "All day" : fmtTime(e.starts_at)}
                </div>
                <div className="text-sm font-semibold truncate flex-1">{e.title}</div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Today's tasks"
          icon={CheckSquare}
          empty={tasks.length === 0 ? "Nothing on today's board." : null}
          link={{ href: "/tasks", label: "Open kanban" }}
        >
          <div className="space-y-2">
            {tasks.map((t) => {
              const priColor =
                t.priority === "high"
                  ? "bg-rose-500/20 text-rose-300"
                  : t.priority === "medium"
                  ? "bg-amber-500/20 text-amber-300"
                  : "bg-zinc-500/20 text-zinc-300";
              return (
                <div
                  key={t.id}
                  className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/5"
                >
                  {t.priority && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold ${priColor}`}
                    >
                      {t.priority[0]}
                    </span>
                  )}
                  <span className="text-sm truncate flex-1">{t.title}</span>
                  {t.flagged && (
                    <AlertTriangle className="size-3.5 text-amber-400 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </SectionCard>
      </div>

      {/* Pulse: reminders, avoidance, captures */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <SectionCard
          title="Active reminders"
          icon={Bell}
          accent={reminders.length > 0 ? "indigo" : undefined}
          link={{ href: "/reminders", label: "All reminders" }}
        >
          {reminders.length === 0 ? (
            <p className="text-xs text-zinc-500">No active reminders.</p>
          ) : (
            <div className="space-y-1.5">
              {reminders.map((r) => (
                <div key={r.id} className="text-sm flex items-baseline justify-between gap-2">
                  <span className="truncate">{r.title}</span>
                  <span className="text-[10px] text-zinc-500 shrink-0">
                    {r.fire_at ? fmtTime(r.fire_at) : "no time"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Avoidance radar"
          icon={AlertTriangle}
          accent={avoidance.length > 0 ? "amber" : undefined}
          link={{ href: "/avoidance", label: "Open radar" }}
        >
          {avoidance.length === 0 ? (
            <p className="text-xs text-zinc-500">Nothing flagged. Keep moving.</p>
          ) : (
            <div className="space-y-1.5">
              {avoidance.slice(0, 5).map((a) => (
                <div key={a.id} className="text-sm flex items-baseline justify-between gap-2">
                  <span className="truncate">{a.title}</span>
                  <span className="text-[10px] text-amber-400/80 shrink-0">
                    {relTime(a.flagged_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Captures (7d)"
          icon={MessageCircle}
          link={{ href: "/chat", label: "Chat with Brain" }}
        >
          <div className="text-3xl font-bold leading-tight">
            {capturesThisWeek}
          </div>
          <div className="text-xs text-zinc-400 mt-1">
            {capturesThisWeek === 0
              ? "Send anything to your Brain — it remembers."
              : `${capturesThisWeek === 1 ? "thing" : "things"} captured this week`}
          </div>
        </SectionCard>
      </div>

      {/* Health snapshot */}
      {(health.stepsToday > 0 ||
        health.lastSleepHours !== null ||
        health.latestWeight) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <MiniStat
            icon={Footprints}
            label="Steps today"
            value={fmtNum(health.stepsToday)}
            sub="from Apple Health"
          />
          <MiniStat
            icon={Moon}
            label="Sleep last night"
            value={
              health.lastSleepHours !== null
                ? `${health.lastSleepHours.toFixed(1)} hr`
                : "—"
            }
            sub={health.lastSleepAt ? relTime(health.lastSleepAt) : "no data"}
          />
          <MiniStat
            icon={Scale}
            label="Latest weight"
            value={
              health.latestWeight
                ? `${health.latestWeight.value.toFixed(1)} ${health.latestWeight.unit ?? "lbs"}`
                : "—"
            }
            sub={
              health.latestWeight ? relTime(health.latestWeight.recorded_at) : "no data"
            }
          />
        </div>
      )}

      {/* 30-day cash flow strip */}
      {finance && (
        <div className="glass rounded-2xl p-4 mb-4 border border-white/10 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            {finance.netFlow30d >= 0 ? (
              <TrendingUp className="size-5 text-emerald-400" />
            ) : (
              <TrendingDown className="size-5 text-rose-400" />
            )}
            <div>
              <div className="text-xs text-zinc-400">30-day cash flow</div>
              <div className="font-bold">
                {finance.netFlow30d >= 0 ? "+" : ""}
                {fmtUsd(finance.netFlow30d, { compact: true })}
              </div>
            </div>
          </div>
          <div className="flex gap-4 text-xs">
            <span>
              <span className="text-zinc-500">Cash</span>{" "}
              <span className="font-semibold">
                {fmtUsd(finance.cashTotal, { compact: true })}
              </span>
            </span>
            <span>
              <span className="text-zinc-500">Net liquid</span>{" "}
              <span className="font-semibold">
                {fmtUsd(finance.netLiquid, { compact: true })}
              </span>
            </span>
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="flex flex-wrap gap-2 mt-6 text-xs">
        {[
          { href: "/chat", label: "💬 Chat" },
          { href: "/goals", label: "🎯 Goals" },
          { href: "/business", label: "💼 Business" },
          { href: "/finance", label: "💰 Finance" },
          { href: "/health", label: "❤️ Health" },
          { href: "/calendar", label: "📅 Calendar" },
          { href: "/tasks", label: "✅ Tasks" },
          { href: "/integrations", label: "🔌 Integrations" },
        ].map((q) => (
          <Link
            key={q.href}
            href={q.href}
            className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white"
          >
            {q.label}
          </Link>
        ))}
      </div>

      {/* Footer ribbon */}
      <div className="text-[10px] text-zinc-500 text-center mt-8">
        Debt free. House. Ring. 🎄
      </div>
    </div>
  );
}

// ---------- subcomponents -------------------------------------------------

function KpiTile({
  label,
  value,
  sub,
  progress,
  gradient,
  href,
}: {
  label: string;
  value: string;
  sub: string;
  progress: number;
  gradient: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="glass-strong rounded-2xl p-4 border border-white/10 hover:border-white/20 transition-colors block"
    >
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">
        {label}
      </div>
      <div className="text-xl md:text-2xl font-bold mt-1 truncate">{value}</div>
      <div className="text-[11px] text-zinc-400 truncate">{sub}</div>
      <div className="mt-2 h-1 rounded-full bg-white/5 overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${gradient}`}
          style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }}
        />
      </div>
    </Link>
  );
}

function SectionCard({
  title,
  icon: Icon,
  children,
  empty,
  link,
  accent,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  empty?: string | null;
  link?: { href: string; label: string };
  accent?: "indigo" | "amber" | "emerald" | "rose";
}) {
  const accentClass =
    accent === "amber"
      ? "border-amber-500/30"
      : accent === "indigo"
      ? "border-indigo-500/30"
      : accent === "emerald"
      ? "border-emerald-500/30"
      : accent === "rose"
      ? "border-rose-500/30"
      : "border-white/10";

  return (
    <div
      className={`glass-strong rounded-2xl p-5 border ${accentClass}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-bold">
          <Icon className="size-4" />
          {title}
        </div>
        {link && (
          <Link
            href={link.href}
            className="text-[11px] text-zinc-400 hover:text-white flex items-center gap-1"
          >
            {link.label}
            <ChevronRight className="size-3" />
          </Link>
        )}
      </div>
      {empty ? (
        <p className="text-xs text-zinc-500">{empty}</p>
      ) : (
        children
      )}
    </div>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="glass rounded-xl p-3 flex items-center gap-3 border border-white/10">
      <Icon className="size-5 text-zinc-300" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 truncate">
          {label}
        </div>
        <div className="font-bold text-sm leading-tight truncate">{value}</div>
        <div className="text-[10px] text-zinc-500 truncate">{sub}</div>
      </div>
    </div>
  );
}

