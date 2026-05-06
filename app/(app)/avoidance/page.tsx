import { AvoidanceView } from "@/components/avoidance-view";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AvoidanceRow = {
  id: string;
  title: string;
  description: string | null;
  flagged: boolean;
  flagged_at: string | null;
  last_touched_at: string;
  escalated_at: string | null;
  completed: boolean;
  completed_at: string | null;
  created_at: string;
};

export default async function AvoidancePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const [activeRes, recentlyResolvedRes, weekStatsRes] = await Promise.all([
    supabase
      .from("avoidance_items")
      .select("*")
      .eq("user_id", user.id)
      .eq("completed", false)
      .order("flagged", { ascending: false })       // flagged first
      .order("flagged_at", { ascending: true, nullsFirst: false }), // oldest flag at top
    supabase
      .from("avoidance_items")
      .select("*")
      .eq("user_id", user.id)
      .eq("completed", true)
      .gte("completed_at", sevenDaysAgo)
      .order("completed_at", { ascending: false })
      .limit(20),
    supabase
      .from("avoidance_items")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("completed", true)
      .gte("completed_at", sevenDaysAgo),
  ]);

  return (
    <AvoidanceView
      active={(activeRes.data ?? []) as AvoidanceRow[]}
      recentlyResolved={(recentlyResolvedRes.data ?? []) as AvoidanceRow[]}
      resolvedThisWeek={weekStatsRes.count ?? 0}
    />
  );
}
