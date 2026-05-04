"use client";

import { useMemo } from "react";
import {
  HeartPulse,
  Scale,
  Footprints,
  Moon,
  Dumbbell,
  Activity,
  Droplet,
  Brain as BrainIcon,
} from "lucide-react";

type MetricRow = {
  metric_type: string;
  value: number;
  unit: string | null;
  recorded_at: string;
  ended_at: string | null;
  source: string;
};

type Props = { metrics: MetricRow[] };

const TZ = "America/New_York";

// ---------- helpers ---------------------------------------------------------

function dayKeyTz(iso: string): string {
  // YYYY-MM-DD in Naldo's tz, so daily aggregates align with his actual day
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function todayKey(): string {
  return dayKeyTz(new Date().toISOString());
}

function avg(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function sum(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0);
}

/** Returns the most recent metric value of `type`, or null if none. */
function latest(metrics: MetricRow[], type: string): MetricRow | null {
  for (const m of metrics) if (m.metric_type === type) return m;
  return null;
}

/** Daily aggregate (sum or last) over the last `days` days, oldest first. */
function dailySeries(
  metrics: MetricRow[],
  type: string,
  days: number,
  reducer: "sum" | "last" | "max"
): { day: string; value: number }[] {
  const buckets = new Map<string, number[]>();
  for (const m of metrics) {
    if (m.metric_type !== type) continue;
    const key = dayKeyTz(m.recorded_at);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(m.value);
  }

  const series: { day: string; value: number }[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const key = dayKeyTz(d.toISOString());
    const vals = buckets.get(key) ?? [];
    let v = 0;
    if (reducer === "sum") v = sum(vals);
    else if (reducer === "max") v = vals.length ? Math.max(...vals) : 0;
    else v = vals.length ? vals[vals.length - 1] : NaN;
    series.push({ day: key, value: v });
  }
  return series;
}

function formatNumber(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
  });
}

// ---------- component -------------------------------------------------------

export function HealthView({ metrics }: Props) {
  const today = todayKey();

  const stats = useMemo(() => {
    const latestWeight = latest(metrics, "weight");
    const latestRhr = latest(metrics, "resting_heart_rate");
    const latestHrv = latest(metrics, "hrv_ms");

    const stepsSeries = dailySeries(metrics, "steps", 14, "sum");
    const sleepSeries = dailySeries(metrics, "sleep_hours", 14, "max");
    const weightSeries90 = dailySeries(metrics, "weight", 90, "last").filter(
      (d) => Number.isFinite(d.value) && d.value > 0
    );
    const workoutMinSeries = dailySeries(metrics, "workout_minutes", 14, "sum");

    const todaySteps =
      stepsSeries.find((d) => d.day === today)?.value ?? 0;
    const sevenDayStepAvg = avg(stepsSeries.slice(-7).map((d) => d.value));

    // Sleep: most recent night with data, else 0
    const sleepLast =
      [...sleepSeries].reverse().find((d) => d.value > 0)?.value ?? 0;
    const sevenDaySleepAvg = avg(
      sleepSeries.slice(-7).map((d) => d.value).filter((v) => v > 0)
    );

    const workoutsThisWeek = workoutMinSeries.slice(-7);
    const workoutMinThisWeek = sum(workoutsThisWeek.map((d) => d.value));
    const workoutDaysThisWeek = workoutsThisWeek.filter((d) => d.value > 0)
      .length;

    return {
      latestWeight,
      latestRhr,
      latestHrv,
      stepsSeries,
      sleepSeries,
      weightSeries90,
      workoutMinSeries,
      todaySteps,
      sevenDayStepAvg,
      sleepLast,
      sevenDaySleepAvg,
      workoutMinThisWeek,
      workoutDaysThisWeek,
    };
  }, [metrics, today]);

  const empty = metrics.length === 0;

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <HeartPulse className="size-7" /> Health
          </h1>
          <p className="text-zinc-400">
            Apple Health, synced via iOS Shortcut.{" "}
            {empty && (
              <a
                href="/integrations#apple-health"
                className="text-indigo-400 hover:underline"
              >
                Set up sync →
              </a>
            )}
          </p>
        </div>
      </div>

      {empty ? <EmptyState /> : null}

      {/* KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard
          icon={Scale}
          label="Weight"
          value={
            stats.latestWeight
              ? `${formatNumber(stats.latestWeight.value, 1)} ${stats.latestWeight.unit ?? "lbs"}`
              : "—"
          }
          sub={
            stats.latestWeight
              ? relativeTime(stats.latestWeight.recorded_at)
              : "no data"
          }
          accent="from-rose-500/20 to-rose-500/5"
        />
        <KpiCard
          icon={Footprints}
          label="Steps today"
          value={formatNumber(stats.todaySteps)}
          sub={`7-day avg ${formatNumber(stats.sevenDayStepAvg)}`}
          accent="from-emerald-500/20 to-emerald-500/5"
        />
        <KpiCard
          icon={Moon}
          label="Sleep last night"
          value={stats.sleepLast > 0 ? `${stats.sleepLast.toFixed(1)} hr` : "—"}
          sub={
            stats.sevenDaySleepAvg > 0
              ? `7-day avg ${stats.sevenDaySleepAvg.toFixed(1)} hr`
              : "no data"
          }
          accent="from-indigo-500/20 to-indigo-500/5"
        />
        <KpiCard
          icon={Dumbbell}
          label="Workouts this wk"
          value={`${stats.workoutDaysThisWeek}d / ${formatNumber(stats.workoutMinThisWeek)} min`}
          sub={
            stats.workoutDaysThisWeek === 0
              ? "lift this week"
              : `${stats.workoutDaysThisWeek === 1 ? "day" : "days"} active`
          }
          accent="from-amber-500/20 to-amber-500/5"
        />
      </div>

      {/* Secondary cardio stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <SmallStat
          icon={Activity}
          label="Resting HR"
          value={stats.latestRhr ? `${formatNumber(stats.latestRhr.value)} bpm` : "—"}
        />
        <SmallStat
          icon={Droplet}
          label="HRV"
          value={
            stats.latestHrv
              ? `${formatNumber(stats.latestHrv.value)} ms`
              : "—"
          }
        />
        <SmallStat
          icon={BrainIcon}
          label="Sleep efficiency"
          value={
            (() => {
              const m = latest(metrics, "sleep_efficiency");
              return m ? `${formatNumber(m.value, 0)}%` : "—";
            })()
          }
        />
      </div>

      {/* Trend charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Weight (90d)" unit={stats.latestWeight?.unit ?? "lbs"}>
          <Sparkline
            points={stats.weightSeries90.map((d) => d.value)}
            color="#f43f5e"
            height={120}
          />
        </ChartCard>

        <ChartCard title="Steps (14d)" unit="">
          <BarChart
            points={stats.stepsSeries}
            color="#10b981"
            height={120}
          />
        </ChartCard>
      </div>
    </div>
  );
}

// ---------- subcomponents ---------------------------------------------------

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

function SmallStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="glass rounded-xl p-3 flex items-center gap-3">
      <Icon className="size-5 text-zinc-300" />
      <div>
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
          {label}
        </div>
        <div className="font-semibold text-sm">{value}</div>
      </div>
    </div>
  );
}

function ChartCard({
  title,
  unit,
  children,
}: {
  title: string;
  unit: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-strong rounded-2xl p-5">
      <div className="flex justify-between items-baseline mb-3">
        <h3 className="font-bold text-sm">{title}</h3>
        {unit && <span className="text-[10px] text-zinc-500">{unit}</span>}
      </div>
      {children}
    </div>
  );
}

function Sparkline({
  points,
  color,
  height = 100,
}: {
  points: number[];
  color: string;
  height?: number;
}) {
  if (points.length === 0) {
    return <EmptyChart>No data yet</EmptyChart>;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const w = 600;
  const h = height;
  const step = points.length > 1 ? w / (points.length - 1) : 0;
  const path = points
    .map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / range) * (h - 8) - 4;
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
        <span>min {min.toFixed(1)}</span>
        <span>max {max.toFixed(1)}</span>
      </div>
    </div>
  );
}

function BarChart({
  points,
  color,
  height = 100,
}: {
  points: { day: string; value: number }[];
  color: string;
  height?: number;
}) {
  if (points.length === 0 || points.every((p) => p.value === 0)) {
    return <EmptyChart>No data yet</EmptyChart>;
  }
  const max = Math.max(...points.map((p) => p.value), 1);
  return (
    <div className="space-y-1">
      <div className="flex items-end gap-1" style={{ height }}>
        {points.map((p) => {
          const h = (p.value / max) * 100;
          const isToday = p.day === todayKey();
          return (
            <div
              key={p.day}
              className="flex-1 rounded-t"
              style={{
                height: `${h}%`,
                backgroundColor: color,
                opacity: isToday ? 1 : 0.55,
              }}
              title={`${p.day}: ${p.value.toLocaleString()}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-zinc-500">
        <span>{points[0]?.day.slice(5)}</span>
        <span>today</span>
      </div>
    </div>
  );
}

function EmptyChart({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center h-24 text-xs text-zinc-500">
      {children}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="glass-strong rounded-2xl p-6 mb-6 border border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 to-pink-500/10">
      <h2 className="font-bold text-lg mb-2">No health data yet</h2>
      <p className="text-sm text-zinc-300 mb-3">
        Set up the iOS Shortcut on your iPhone to sync Apple Health data here
        every hour. Once configured it runs in the background — no app needed.
      </p>
      <a
        href="/integrations#apple-health"
        className="inline-flex items-center gap-1 text-sm text-indigo-300 hover:text-indigo-200 underline"
      >
        Get setup instructions →
      </a>
    </div>
  );
}
