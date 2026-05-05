"use client";

import { useMemo } from "react";
import {
  HeartPulse,
  Scale,
  Footprints,
  Moon,
  Dumbbell,
  Activity,
  Brain as BrainIcon,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Info,
} from "lucide-react";

type MetricRow = {
  metric_type: string;
  value: number;
  unit: string | null;
  recorded_at: string;
  ended_at: string | null;
  source: string;
};

type HealthGoals = {
  weight_lbs: number;
  steps_daily: number;
  sleep_hours_nightly: number;
  workout_days_weekly: number;
};

type Props = { metrics: MetricRow[]; goals: HealthGoals };

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

export function HealthView({ metrics, goals }: Props) {
  const today = todayKey();

  const stats = useMemo(() => {
    const latestWeight = latest(metrics, "weight");
    const latestSleepEff = latest(metrics, "sleep_efficiency");
    const latestBodyFat = latest(metrics, "body_fat_percent");

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
      latestSleepEff,
      latestBodyFat,
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
              ? `goal ${goals.weight_lbs} · ${relativeTime(stats.latestWeight.recorded_at)}`
              : "no data"
          }
          progress={
            stats.latestWeight
              ? // Lower-is-better when current > goal: invert so closer-to-goal fills more.
                Math.max(0, Math.min(1, goals.weight_lbs / stats.latestWeight.value))
              : 0
          }
          accent="from-rose-500/20 to-rose-500/5"
        />
        <KpiCard
          icon={Footprints}
          label="Steps today"
          value={formatNumber(stats.todaySteps)}
          sub={`goal ${formatNumber(goals.steps_daily)} · 7d avg ${formatNumber(stats.sevenDayStepAvg)}`}
          progress={Math.max(0, Math.min(1, stats.todaySteps / goals.steps_daily))}
          accent="from-emerald-500/20 to-emerald-500/5"
        />
        <KpiCard
          icon={Moon}
          label="Sleep last night"
          value={stats.sleepLast > 0 ? `${stats.sleepLast.toFixed(1)} hr` : "—"}
          sub={
            stats.sleepLast > 0
              ? `goal ${goals.sleep_hours_nightly}h · 7d avg ${
                  stats.sevenDaySleepAvg > 0 ? stats.sevenDaySleepAvg.toFixed(1) : "—"
                }h`
              : "no data"
          }
          progress={
            stats.sleepLast > 0
              ? Math.max(0, Math.min(1, stats.sleepLast / goals.sleep_hours_nightly))
              : 0
          }
          accent="from-indigo-500/20 to-indigo-500/5"
        />
        <KpiCard
          icon={Dumbbell}
          label="Workouts this wk"
          value={`${stats.workoutDaysThisWeek}d / ${formatNumber(stats.workoutMinThisWeek)} min`}
          sub={`goal ${goals.workout_days_weekly} ${goals.workout_days_weekly === 1 ? "day" : "days"}/wk`}
          progress={Math.max(
            0,
            Math.min(1, stats.workoutDaysThisWeek / goals.workout_days_weekly)
          )}
          accent="from-amber-500/20 to-amber-500/5"
        />
      </div>

      {/* Body composition (rendered only when data present) */}
      {(stats.latestBodyFat || stats.latestSleepEff) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          {stats.latestBodyFat && (
            <SmallStat
              icon={Activity}
              label="Body fat"
              value={`${formatNumber(stats.latestBodyFat.value, 1)}%`}
            />
          )}
          {stats.latestSleepEff && (
            <SmallStat
              icon={BrainIcon}
              label="Sleep efficiency"
              value={`${formatNumber(stats.latestSleepEff.value, 0)}%`}
            />
          )}
        </div>
      )}

      {/* Coach — rule-based tips against your goals */}
      <CoachCard stats={stats} goals={goals} />

      {/* Trend charts — 4 charts each 14d (or 90d for weight) so every goal has a visual */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Weight (90d)" unit={stats.latestWeight?.unit ?? "lbs"}>
          <Sparkline
            points={stats.weightSeries90.map((d) => d.value)}
            color="#f43f5e"
            goalLine={goals.weight_lbs}
            height={140}
          />
        </ChartCard>

        <ChartCard title="Steps (14d)" unit="">
          <BarChart
            points={stats.stepsSeries}
            color="#10b981"
            goalLine={goals.steps_daily}
            height={140}
          />
        </ChartCard>

        <ChartCard title="Sleep (14d)" unit="hr">
          <BarChart
            points={stats.sleepSeries}
            color="#6366f1"
            goalLine={goals.sleep_hours_nightly}
            height={140}
            emptyMsg="No sleep data — toggle Sleep Analysis on in HAE."
          />
        </ChartCard>

        <ChartCard title="Workout minutes (14d)" unit="min">
          <BarChart
            points={stats.workoutMinSeries}
            color="#f59e0b"
            height={140}
            emptyMsg="No workout data — toggle Workouts on in HAE."
          />
        </ChartCard>
      </div>
    </div>
  );
}

// ---------- Coach card ------------------------------------------------------

type Tip = { tone: "good" | "warn" | "info"; text: string };

function CoachCard({
  stats,
  goals,
}: {
  stats: {
    latestWeight: MetricRow | null;
    todaySteps: number;
    sevenDayStepAvg: number;
    sleepLast: number;
    sevenDaySleepAvg: number;
    workoutDaysThisWeek: number;
    workoutMinThisWeek: number;
    weightSeries90: { day: string; value: number }[];
  };
  goals: HealthGoals;
}) {
  const tips = useMemo(() => generateTips(stats, goals), [stats, goals]);
  if (tips.length === 0) return null;

  const toGo = stats.latestWeight
    ? Math.max(0, stats.latestWeight.value - goals.weight_lbs)
    : 0;

  return (
    <div className="glass-strong rounded-2xl p-5 mb-4 border border-indigo-500/20">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="size-4 text-indigo-300" />
        <h3 className="font-bold text-sm">Coach</h3>
        <span className="text-[10px] text-zinc-500 ml-1">
          targets: {goals.weight_lbs} lb · {formatNumber(goals.steps_daily)} steps · {goals.sleep_hours_nightly}h sleep · {goals.workout_days_weekly} workouts/wk
        </span>
      </div>
      <ul className="space-y-2">
        {tips.map((t, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            {t.tone === "good" && (
              <CheckCircle2 className="size-4 text-emerald-400 mt-0.5 shrink-0" />
            )}
            {t.tone === "warn" && (
              <AlertTriangle className="size-4 text-amber-400 mt-0.5 shrink-0" />
            )}
            {t.tone === "info" && (
              <Info className="size-4 text-indigo-300 mt-0.5 shrink-0" />
            )}
            <span className="text-zinc-200">{t.text}</span>
          </li>
        ))}
      </ul>
      {toGo > 0 && (
        <div className="text-[11px] text-zinc-500 mt-3 pt-3 border-t border-white/5">
          At a sustainable 1.5 lb/wk loss, you&apos;d hit {goals.weight_lbs} lb in ~
          {Math.ceil(toGo / 1.5)} weeks. 1 lb/wk = ~{Math.ceil(toGo)} weeks.
        </div>
      )}
    </div>
  );
}

function generateTips(
  stats: {
    latestWeight: MetricRow | null;
    todaySteps: number;
    sevenDayStepAvg: number;
    sleepLast: number;
    sevenDaySleepAvg: number;
    workoutDaysThisWeek: number;
    workoutMinThisWeek: number;
    weightSeries90: { day: string; value: number }[];
  },
  goals: HealthGoals
): Tip[] {
  const tips: Tip[] = [];

  // Compute weight delta from the 7d-ago closest reading
  let weightDelta7d: number | null = null;
  if (stats.latestWeight && stats.weightSeries90.length >= 2) {
    const last = stats.latestWeight.value;
    const target = Date.now() - 7 * 86400000;
    const ref = stats.weightSeries90
      .map((p) => ({
        v: p.value,
        diff: Math.abs(new Date(p.day).getTime() - target),
      }))
      .sort((a, b) => a.diff - b.diff)[0];
    if (ref && ref.diff < 5 * 86400000) {
      weightDelta7d = +(last - ref.v).toFixed(1);
    }
  }

  // Weight
  if (stats.latestWeight) {
    const lbsToGo = stats.latestWeight.value - goals.weight_lbs;
    if (lbsToGo <= 0) {
      tips.push({
        tone: "good",
        text: `At or below ${goals.weight_lbs} lb. Maintenance — keep training and protein.`,
      });
    } else if (weightDelta7d !== null && weightDelta7d > 0.5) {
      tips.push({
        tone: "warn",
        text: `Weight up ${weightDelta7d.toFixed(1)} lb this week, ${lbsToGo.toFixed(1)} lb from goal. Tighten calories — audit weekend eating first.`,
      });
    } else if (weightDelta7d !== null && weightDelta7d < -0.3) {
      tips.push({
        tone: "good",
        text: `Down ${Math.abs(weightDelta7d).toFixed(1)} lb this week — that's the right pace. Stay the course.`,
      });
    } else {
      tips.push({
        tone: "info",
        text: `${lbsToGo.toFixed(1)} lb to goal. 500 cal/day deficit ≈ 1 lb/wk; 750/day ≈ 1.5 lb/wk.`,
      });
    }
  }

  // Steps — today
  if (stats.todaySteps > 0) {
    const todayPct = stats.todaySteps / goals.steps_daily;
    if (todayPct >= 1) {
      tips.push({
        tone: "good",
        text: `Already past ${formatNumber(goals.steps_daily)} steps today. Pure win.`,
      });
    } else if (todayPct < 0.4) {
      const remaining = goals.steps_daily - stats.todaySteps;
      tips.push({
        tone: "warn",
        text: `${formatNumber(remaining)} steps left to hit ${formatNumber(goals.steps_daily)} today. A 30-min walk closes ~3,500.`,
      });
    }
  }

  // Steps — 7d trend
  if (
    stats.sevenDayStepAvg > 0 &&
    stats.sevenDayStepAvg < goals.steps_daily * 0.7
  ) {
    tips.push({
      tone: "warn",
      text: `7-day avg ${formatNumber(stats.sevenDayStepAvg)} — well under ${formatNumber(goals.steps_daily)}. Lock a daily walk on the calendar.`,
    });
  }

  // Sleep — last night
  if (stats.sleepLast > 0) {
    const deficit = goals.sleep_hours_nightly - stats.sleepLast;
    if (deficit >= 1.5) {
      tips.push({
        tone: "warn",
        text: `${stats.sleepLast.toFixed(1)} hr last night — ${deficit.toFixed(1)} short. Hard cutoff at 11pm tonight.`,
      });
    } else if (deficit > 0) {
      tips.push({
        tone: "info",
        text: `${stats.sleepLast.toFixed(1)} hr last night. Push lights-out 30 min earlier to hit ${goals.sleep_hours_nightly}.`,
      });
    }
  }

  // Sleep — chronic deficit (skip if we already nudged about last night)
  if (
    stats.sleepLast === 0 &&
    stats.sevenDaySleepAvg > 0 &&
    stats.sevenDaySleepAvg < goals.sleep_hours_nightly - 0.75
  ) {
    tips.push({
      tone: "warn",
      text: `Sleeping ${stats.sevenDaySleepAvg.toFixed(1)} hr/night avg — chronic ${(goals.sleep_hours_nightly - stats.sevenDaySleepAvg).toFixed(1)} hr deficit. Fix the bedtime, not the morning.`,
    });
  }

  // Workouts
  if (stats.workoutDaysThisWeek === 0) {
    tips.push({
      tone: "warn",
      text: "No workouts logged this week. Even a 20-min walk gets you on the board.",
    });
  } else if (stats.workoutDaysThisWeek >= goals.workout_days_weekly) {
    tips.push({
      tone: "good",
      text: `${stats.workoutDaysThisWeek} workout days hit the ${goals.workout_days_weekly}+ goal. Recovery days matter as much as hard days.`,
    });
  }

  return tips;
}

// ---------- subcomponents ---------------------------------------------------

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
  progress,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  accent: string;
  progress?: number;        // 0..1 — renders a small progress bar when defined
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
      {typeof progress === "number" && (
        <div className="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-white/70"
            style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }}
          />
        </div>
      )}
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
  goalLine,
}: {
  points: number[];
  color: string;
  height?: number;
  goalLine?: number;
}) {
  if (points.length === 0) {
    return <EmptyChart>No data yet</EmptyChart>;
  }
  const min = Math.min(...points, goalLine ?? Infinity);
  const max = Math.max(...points, goalLine ?? -Infinity);
  const range = max - min || 1;
  const w = 600;
  const h = height;
  const step = points.length > 1 ? w / (points.length - 1) : 0;
  const yFor = (v: number) => h - ((v - min) / range) * (h - 8) - 4;
  const path = points
    .map((v, i) => `${i === 0 ? "M" : "L"} ${i * step} ${yFor(v)}`)
    .join(" ");

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
        {goalLine !== undefined && (
          <line
            x1={0}
            y1={yFor(goalLine)}
            x2={w}
            y2={yFor(goalLine)}
            stroke="#a1a1aa"
            strokeWidth="1"
            strokeDasharray="4 4"
            opacity="0.5"
          />
        )}
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
        {goalLine !== undefined && <span className="text-zinc-400">goal {goalLine}</span>}
        <span>max {max.toFixed(1)}</span>
      </div>
    </div>
  );
}

function BarChart({
  points,
  color,
  height = 100,
  goalLine,
  emptyMsg = "No data yet",
}: {
  points: { day: string; value: number }[];
  color: string;
  height?: number;
  goalLine?: number;
  emptyMsg?: string;
}) {
  if (points.length === 0 || points.every((p) => p.value === 0)) {
    return <EmptyChart>{emptyMsg}</EmptyChart>;
  }
  const max = Math.max(...points.map((p) => p.value), goalLine ?? 1);
  const goalPct = goalLine !== undefined ? (goalLine / max) * 100 : null;
  return (
    <div className="space-y-1">
      <div className="relative flex items-end gap-1" style={{ height }}>
        {goalPct !== null && (
          <div
            className="absolute left-0 right-0 border-t border-dashed border-white/30 pointer-events-none"
            style={{ bottom: `${goalPct}%` }}
            title={`Goal ${goalLine}`}
          />
        )}
        {points.map((p) => {
          const h = (p.value / max) * 100;
          const isToday = p.day === todayKey();
          const hitGoal = goalLine !== undefined && p.value >= goalLine;
          return (
            <div
              key={p.day}
              className="flex-1 rounded-t"
              style={{
                height: `${h}%`,
                backgroundColor: color,
                opacity: isToday ? 1 : hitGoal ? 0.85 : 0.5,
              }}
              title={`${p.day}: ${p.value.toLocaleString()}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-zinc-500">
        <span>{points[0]?.day.slice(5)}</span>
        {goalLine !== undefined && (
          <span className="text-zinc-400">goal {goalLine.toLocaleString()}</span>
        )}
        <span>today</span>
      </div>
    </div>
  );
}

function EmptyChart({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center h-32 text-xs text-zinc-500 px-4 text-center">
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
