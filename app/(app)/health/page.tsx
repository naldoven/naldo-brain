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

export default async function HealthPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Pull last 90 days — enough for the weight trend + 7-day rolling averages
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();

  const { data: metrics } = await supabase
    .from("health_metrics")
    .select("metric_type, value, unit, recorded_at, ended_at, source")
    .eq("user_id", user.id)
    .gte("recorded_at", ninetyDaysAgo)
    .order("recorded_at", { ascending: false })
    .limit(2000);

  return <HealthView metrics={(metrics ?? []) as MetricRow[]} />;
}
