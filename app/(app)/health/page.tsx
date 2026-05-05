import { HealthView } from "@/components/health-view";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type MetricRow = {
  metric_type: string;
  value: number;
  unit: string | null;
  recorded_at: string;
  ended_at: string | null;
  source: string;
};

// Splitting the query keeps high-frequency metrics (steps, heart_rate) from
// crowding out single-value-per-day metrics (weight, RHR) under any global
// limit. Each query has its own appropriate window + cap.
const SUMMARY_TYPES = [
  "weight",
  "body_fat_percent",
  "lean_body_mass",
  "resting_heart_rate",
  "hrv_ms",
  "sleep_efficiency",
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
    // 90 days of low-frequency metrics — feeds KPI cards + 90d weight chart.
    supabase
      .from("health_metrics")
      .select("metric_type, value, unit, recorded_at, ended_at, source")
      .eq("user_id", user.id)
      .in("metric_type", SUMMARY_TYPES)
      .gte("recorded_at", ninetyDaysAgo)
      .order("recorded_at", { ascending: false })
      .limit(2000),

    // 14 days of high-frequency metrics — feeds today's totals + 14d charts.
    // Steps especially can be ~2-3k samples/day on Apple Watch, so cap is high.
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

  return <HealthView metrics={metrics} />;
}
