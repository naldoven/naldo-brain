"use client";

import { useMemo } from "react";
import {
  Briefcase,
  TrendingUp,
  DollarSign,
  Users,
  Target,
  Calendar,
} from "lucide-react";

type OppRow = {
  external_id: string;
  name: string | null;
  monetary_value: number;
  status?: string | null;
  pipeline_name: string | null;
  pipeline_stage_name: string | null;
  contact_name: string | null;
  source?: string | null;
  ghl_created_at?: string | null;
  ghl_updated_at?: string | null;
  ghl_status_changed_at?: string | null;
};

type Props = {
  revenueYtd: number;
  revenueTarget: number;
  pipelineValue: number;
  openCount: number;
  wonThisWeekCount: number;
  wonThisWeekValue: number;
  recent: OppRow[];
  openOpps: OppRow[];
  hasAnyData: boolean;
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

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
  });
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 30) return `${d}d ago`;
  return fmtDate(iso);
}

function statusBadgeColor(status: string | null | undefined): string {
  switch (status) {
    case "won":
      return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
    case "lost":
      return "bg-rose-500/20 text-rose-300 border-rose-500/40";
    case "abandoned":
      return "bg-zinc-500/20 text-zinc-300 border-zinc-500/40";
    default:
      return "bg-indigo-500/20 text-indigo-300 border-indigo-500/40";
  }
}

export function BusinessView({
  revenueYtd,
  revenueTarget,
  pipelineValue,
  openCount,
  wonThisWeekCount,
  wonThisWeekValue,
  recent,
  openOpps,
  hasAnyData,
}: Props) {
  const progress = Math.min(1, revenueYtd / revenueTarget);
  const remaining = Math.max(0, revenueTarget - revenueYtd);
  const todayOfYear = useMemo(() => {
    const start = new Date(new Date().getFullYear(), 0, 1).getTime();
    return Math.max(1, Math.round((Date.now() - start) / 86400000));
  }, []);
  const dailyPace = revenueYtd / todayOfYear;
  const projectedYearEnd = dailyPace * 365;

  // Group open opportunities by stage for a tiny funnel.
  const byStage = useMemo(() => {
    const m = new Map<string, { count: number; value: number }>();
    for (const o of openOpps) {
      const k = o.pipeline_stage_name || "(no stage)";
      if (!m.has(k)) m.set(k, { count: 0, value: 0 });
      const e = m.get(k)!;
      e.count++;
      e.value += o.monetary_value || 0;
    }
    return Array.from(m.entries()).sort((a, b) => b[1].value - a[1].value);
  }, [openOpps]);

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Briefcase className="size-7" /> Business
          </h1>
          <p className="text-zinc-400">
            Yule Love Lights · GoHighLevel pipeline. Synced every 30 min.
          </p>
        </div>
      </div>

      {!hasAnyData && <EmptyState />}

      {/* Revenue progress hero */}
      <div className="glass-strong rounded-2xl p-6 mb-4 bg-gradient-to-br from-amber-500/15 via-pink-500/10 to-indigo-500/15 border border-white/10">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <div className="text-xs text-zinc-400 flex items-center gap-2 mb-1">
              <Target className="size-3.5" /> 2026 revenue target
            </div>
            <div className="text-4xl font-bold">
              {fmtUsd(revenueYtd)}{" "}
              <span className="text-zinc-500 font-normal text-2xl">
                / {fmtUsd(revenueTarget, { compact: true })}
              </span>
            </div>
            <div className="text-sm text-zinc-400 mt-1">
              {(progress * 100).toFixed(1)}% of $500K · {fmtUsd(remaining, { compact: true })} to go
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-zinc-400">Pace</div>
            <div className="text-2xl font-semibold">
              {fmtUsd(projectedYearEnd, { compact: true })}{" "}
              <span className="text-xs text-zinc-500">EOY at current</span>
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              {fmtUsd(dailyPace, { compact: true })}/day · day {todayOfYear} of 365
            </div>
          </div>
        </div>

        <div className="mt-5 h-3 rounded-full bg-white/5 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-amber-400 via-pink-500 to-indigo-500 transition-all"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <KpiCard
          icon={DollarSign}
          label="Pipeline value"
          value={fmtUsd(pipelineValue, { compact: true })}
          sub={`${openCount} open ${openCount === 1 ? "deal" : "deals"}`}
          accent="from-indigo-500/20 to-indigo-500/5"
        />
        <KpiCard
          icon={TrendingUp}
          label="Won this week"
          value={fmtUsd(wonThisWeekValue, { compact: true })}
          sub={`${wonThisWeekCount} ${wonThisWeekCount === 1 ? "deal" : "deals"} closed`}
          accent="from-emerald-500/20 to-emerald-500/5"
        />
        <KpiCard
          icon={Users}
          label="Days remaining"
          value={(365 - todayOfYear).toString()}
          sub={`need ${fmtUsd(remaining / Math.max(1, 365 - todayOfYear), { compact: true })}/day`}
          accent="from-rose-500/20 to-rose-500/5"
        />
      </div>

      {/* Pipeline by stage */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="glass-strong rounded-2xl p-5">
          <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
            <Calendar className="size-4" /> Open pipeline by stage
          </h3>
          {byStage.length === 0 ? (
            <p className="text-xs text-zinc-500">Nothing open.</p>
          ) : (
            <div className="space-y-2">
              {byStage.map(([stage, agg]) => {
                const pct =
                  pipelineValue > 0 ? (agg.value / pipelineValue) * 100 : 0;
                return (
                  <div key={stage}>
                    <div className="flex justify-between items-baseline text-xs">
                      <span className="text-zinc-300 truncate">{stage}</span>
                      <span className="text-zinc-500 ml-2">
                        {agg.count} · {fmtUsd(agg.value, { compact: true })}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/5 mt-1 overflow-hidden">
                      <div
                        className="h-full bg-indigo-400/70"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent activity */}
        <div className="glass-strong rounded-2xl p-5">
          <h3 className="font-bold text-sm mb-3">Recent activity</h3>
          {recent.length === 0 ? (
            <p className="text-xs text-zinc-500">No deals yet.</p>
          ) : (
            <div className="space-y-2">
              {recent.map((o) => (
                <div
                  key={o.external_id}
                  className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-white/5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">
                      {o.name || o.contact_name || "(no title)"}
                    </div>
                    <div className="text-[11px] text-zinc-500 truncate">
                      {o.contact_name && o.name && o.contact_name !== o.name
                        ? `${o.contact_name} · `
                        : ""}
                      {o.pipeline_stage_name ?? o.pipeline_name ?? "—"}
                      {o.source ? ` · ${o.source}` : ""}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold">
                      {fmtUsd(o.monetary_value || 0, { compact: true })}
                    </div>
                    <div
                      className={`inline-block text-[9px] px-2 py-0.5 rounded-full border mt-1 ${statusBadgeColor(
                        o.status
                      )}`}
                    >
                      {o.status ?? "open"} ·{" "}
                      {relTime(
                        o.ghl_status_changed_at ??
                          o.ghl_updated_at ??
                          o.ghl_created_at
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  accent: string;
}) {
  return (
    <div
      className={`glass rounded-2xl p-4 bg-gradient-to-br ${accent} border border-white/10`}
    >
      <div className="flex items-center gap-2 text-xs text-zinc-300">
        <Icon className="size-4" />
        {label}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      <div className="text-[11px] text-zinc-400 mt-0.5">{sub}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="glass-strong rounded-2xl p-6 mb-6 border border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 to-pink-500/10">
      <h2 className="font-bold text-lg mb-2">Connect GoHighLevel</h2>
      <p className="text-sm text-zinc-300 mb-3">
        No GHL data yet. Generate a Private Integration Token, add{" "}
        <code className="text-xs">GHL_API_KEY</code>,{" "}
        <code className="text-xs">GHL_LOCATION_ID</code>, and{" "}
        <code className="text-xs">GHL_OWNER_USER_ID</code> to Render, then
        trigger a sync.
      </p>
      <p className="text-xs text-zinc-400">
        Setup steps live in <code>PHASE3-PROGRESS.md</code> at the project root.
      </p>
    </div>
  );
}
