import { IntegrationsView } from "@/components/integrations-view";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [googleRes, plaidRes, ghlCountRes, ghlLastSyncRes, healthCountRes, healthLatestRes, healthByTypeRes] =
    await Promise.all([
      supabase
        .from("google_connections")
        .select("integration, account_email, last_synced_at, scope, created_at")
        .eq("user_id", user!.id)
        .eq("integration", "calendar")
        .maybeSingle(),
      supabase
        .from("plaid_items")
        .select("id, institution_name, status, last_synced_at, scope")
        .eq("user_id", user!.id)
        .order("created_at"),
      supabase
        .from("gohighlevel_opportunities")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id),
      supabase
        .from("gohighlevel_opportunities")
        .select("synced_at")
        .eq("user_id", user!.id)
        .order("synced_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("health_metrics")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id),
      supabase
        .from("health_metrics")
        .select("recorded_at")
        .eq("user_id", user!.id)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Per-metric most-recent timestamp + count for the last 7 days. We pull
      // recent rows and aggregate client-side because PostgREST can't
      // GROUP BY without a database view.
      supabase
        .from("health_metrics")
        .select("metric_type, recorded_at")
        .eq("user_id", user!.id)
        .gte("recorded_at", new Date(Date.now() - 7 * 86400000).toISOString())
        .order("recorded_at", { ascending: false })
        .limit(5000),
    ]);

  // Aggregate per-metric stats client-side
  const healthByType = (healthByTypeRes.data ?? []) as Array<{
    metric_type: string;
    recorded_at: string;
  }>;
  const byType = new Map<string, { count: number; latest: string }>();
  for (const row of healthByType) {
    const existing = byType.get(row.metric_type);
    if (!existing) {
      byType.set(row.metric_type, { count: 1, latest: row.recorded_at });
    } else {
      existing.count++;
      // Rows arrive ordered desc, so first one we see is already latest
    }
  }

  return (
    <IntegrationsView
      googleCalendar={googleRes.data ?? null}
      plaidItems={plaidRes.data ?? []}
      ghl={{
        configured: !!process.env.GHL_API_KEY && !!process.env.GHL_LOCATION_ID,
        opportunityCount: ghlCountRes.count ?? 0,
        lastSyncedAt: ghlLastSyncRes.data?.synced_at ?? null,
      }}
      health={{
        configured:
          !!process.env.HEALTH_INGEST_SECRET && !!process.env.HEALTH_INGEST_USER_ID,
        totalSamples: healthCountRes.count ?? 0,
        lastReceivedAt: healthLatestRes.data?.recorded_at ?? null,
        byType: Array.from(byType.entries())
          .map(([metric_type, v]) => ({
            metric_type,
            count_7d: v.count,
            latest: v.latest,
          }))
          .sort((a, b) => b.count_7d - a.count_7d),
      }}
    />
  );
}
