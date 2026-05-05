import { HealthView } from "@/components/health-view";
import { createClient } from "@/lib/supabase/server";
import { HEALTH_GOALS } from "@/lib/health";

export const dynamic = "force-dynamic";

type MetricRow = {
  metric_type: string;
  value: number;
  unit: string | null;
  recorded_at: string;
  ended_at: string | null;
  source: string;
};

// Splitting the query keeps high-frequency metrics (steps) from crowding
// out single-value-per-day metrics (weight) under any global limit.
const SUMMARY_TYPES = [
  "weight",
  "body_fat_percent",
  "lean_body_mass",
  "sleep_efficiency",
  // Removed RHR + HRV per Naldo's request — not tracked, not needed in UI
];

const SERIES_TYPES = ["steps", "sleep_hours", "workout_minutes"];

export default async function HealthPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

  const [summaryRes, seriesRes] = await Promise.all([
    supabase
      .from("health_metrics")
      .select("metric_type, value, unit, recorded_at, ended_at, source")
      .eq("user_id", user.id)
      .in("metric_type", SUMMARY_TYPES)
      .gte("recorded_at", ninetyDaysAgo)
      .order("recorded_at", { ascending: false })
      .limit(2000),
    supabase
      .from("health_metrics")
      .select("metric_type, value, unit, recorded_at, ended_at, source")
      .eq("user_id", user.id)
      .in("metric_type", SERIES_TYPES)
      .gte("recorded_at", fourteenDaysAgo)
      .order("recorded_at", { ascending: false })
      .limit(50000),
  ]);

  const metrics: MetricRow[] = [
    ...((summaryRes.data ?? []) as MetricRow[]),
    ...((seriesRes.data ?? []) as MetricRow[]),
  ];

  return <HealthView metrics={metrics} goals={HEALTH_GOALS} />;
}
