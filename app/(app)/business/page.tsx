import { BusinessView } from "@/components/business-view";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type OppRow = {
  external_id: string;
  name: string | null;
  monetary_value: number;
  status: string | null;
  pipeline_name: string | null;
  pipeline_stage_name: string | null;
  contact_name: string | null;
  source: string | null;
  ghl_created_at: string | null;
  ghl_updated_at: string | null;
  ghl_status_changed_at: string | null;
};

const REVENUE_TARGET_USD = 500000;

export default async function BusinessPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const yearStartIso = new Date(new Date().getFullYear(), 0, 1).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const [ytdWonRes, openRes, recentRes, weekWonRes] = await Promise.all([
    // Revenue YTD: every won deal with status_changed_at this calendar year.
    // Falls back to ghl_updated_at when status_changed_at is missing.
    supabase
      .from("gohighlevel_opportunities")
      .select("external_id, name, monetary_value, ghl_status_changed_at, ghl_updated_at")
      .eq("user_id", user.id)
      .eq("status", "won")
      .or(
        `ghl_status_changed_at.gte.${yearStartIso},and(ghl_status_changed_at.is.null,ghl_updated_at.gte.${yearStartIso})`
      ),

    // All currently-open opportunities — these are the pipeline.
    supabase
      .from("gohighlevel_opportunities")
      .select(
        "external_id, name, monetary_value, pipeline_name, pipeline_stage_name, contact_name, source, ghl_created_at"
      )
      .eq("user_id", user.id)
      .eq("status", "open"),

    // Recent activity feed — last 10 opportunities touched.
    supabase
      .from("gohighlevel_opportunities")
      .select(
        "external_id, name, monetary_value, status, pipeline_name, pipeline_stage_name, contact_name, source, ghl_created_at, ghl_updated_at, ghl_status_changed_at"
      )
      .eq("user_id", user.id)
      .order("ghl_updated_at", { ascending: false, nullsFirst: false })
      .limit(10),

    // Wins this week — what closed in the last 7 days.
    supabase
      .from("gohighlevel_opportunities")
      .select("external_id, name, monetary_value, contact_name, ghl_status_changed_at")
      .eq("user_id", user.id)
      .eq("status", "won")
      .gte("ghl_status_changed_at", sevenDaysAgo)
      .order("ghl_status_changed_at", { ascending: false }),
  ]);

  const ytdWon = (ytdWonRes.data ?? []) as Array<{ monetary_value: number }>;
  const open = (openRes.data ?? []) as OppRow[];
  const recent = (recentRes.data ?? []) as OppRow[];
  const weekWon = (weekWonRes.data ?? []) as OppRow[];

  const revenueYtd = ytdWon.reduce((s, o) => s + (o.monetary_value || 0), 0);
  const pipelineValue = open.reduce((s, o) => s + (o.monetary_value || 0), 0);
  const wonThisWeekValue = weekWon.reduce((s, o) => s + (o.monetary_value || 0), 0);

  return (
    <BusinessView
      revenueYtd={revenueYtd}
      revenueTarget={REVENUE_TARGET_USD}
      pipelineValue={pipelineValue}
      openCount={open.length}
      wonThisWeekCount={weekWon.length}
      wonThisWeekValue={wonThisWeekValue}
      recent={recent}
      openOpps={open}
      hasAnyData={recent.length > 0 || open.length > 0}
    />
  );
}
