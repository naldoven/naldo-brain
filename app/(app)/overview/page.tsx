import { OverviewView } from "@/components/overview-view";
import { createClient } from "@/lib/supabase/server";
import { DEBT_BASELINE_USD, summarizeFinance } from "@/lib/plaid";

export const dynamic = "force-dynamic";

const REVENUE_TARGET_USD = 500000;
const TZ = "America/New_York";

/** Returns the UTC instant that equals 00:00 in `tz` on `now`'s local date. */
function startOfDayInTz(now: Date, tz: string): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const probe = new Date(`${ymd}T12:00:00Z`);
  const hourInTz = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).format(probe),
    10
  );
  return new Date(probe.getTime() - hourInTz * 60 * 60 * 1000);
}

export default async function OverviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const now = new Date();
  const startOfToday = startOfDayInTz(now, TZ);
  const endOfToday = new Date(startOfToday.getTime() + 86400000);
  const yearStartIso = new Date(now.getFullYear(), 0, 1).toISOString();
  const oneWeekAgoIso = new Date(now.getTime() - 7 * 86400000).toISOString();
  const thirtyDaysAgoIso = new Date(now.getTime() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  const fourteenDaysAgoIso = new Date(now.getTime() - 14 * 86400000).toISOString();

  // Display name
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, name")
    .eq("id", user.id)
    .maybeSingle();

  const [
    eventsRes,
    tasksRes,
    remindersRes,
    capturesRes,
    avoidanceRes,
    ghlYtdRes,
    ghlOpenRes,
    plaidAccountsRes,
    plaidTxRes,
    healthRes,
  ] = await Promise.all([
    supabase
      .from("calendar_events")
      .select("id, title, starts_at, all_day, color, source")
      .eq("user_id", user.id)
      .gte("starts_at", startOfToday.toISOString())
      .lt("starts_at", endOfToday.toISOString())
      .order("starts_at"),
    supabase
      .from("tasks")
      .select("id, title, priority, flagged, status")
      .eq("user_id", user.id)
      .eq("status", "today")
      .order("priority")
      .limit(20),
    supabase
      .from("reminders")
      .select("id, title, fire_at")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("fire_at", { ascending: true, nullsFirst: false })
      .limit(5),
    supabase
      .from("captures")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", oneWeekAgoIso),
    supabase
      .from("avoidance_items")
      .select("id, title, flagged_at")
      .eq("user_id", user.id)
      .eq("flagged", true)
      .eq("completed", false)
      .order("flagged_at"),
    supabase
      .from("gohighlevel_opportunities")
      .select("monetary_value, ghl_status_changed_at, ghl_updated_at")
      .eq("user_id", user.id)
      .eq("status", "won")
      .or(
        `ghl_status_changed_at.gte.${yearStartIso},and(ghl_status_changed_at.is.null,ghl_updated_at.gte.${yearStartIso})`
      ),
    supabase
      .from("gohighlevel_opportunities")
      .select("monetary_value")
      .eq("user_id", user.id)
      .eq("status", "open"),
    // The $55K debt-payoff KPI on /overview tracks PERSONAL debt (YLL
    // business has no debt to pay off). 30-day flow follows the same scope
    // for consistency — it's the cash that actually services the debt.
    supabase
      .from("plaid_accounts")
      .select(
        "type, current_balance, is_debt, is_active, plaid_items!inner(scope)"
      )
      .eq("user_id", user.id)
      .eq("is_active", true)
      .eq("plaid_items.scope", "personal"),
    supabase
      .from("plaid_transactions")
      .select(
        "amount, date, plaid_accounts!inner(plaid_items!inner(scope))"
      )
      .eq("user_id", user.id)
      .gte("date", thirtyDaysAgoIso)
      .eq("plaid_accounts.plaid_items.scope", "personal")
      .limit(5000),
    supabase
      .from("health_metrics")
      .select("metric_type, value, unit, recorded_at")
      .eq("user_id", user.id)
      .gte("recorded_at", fourteenDaysAgoIso)
      .order("recorded_at", { ascending: false })
      .limit(2000),
  ]);

  // -- Business
  const ytdWonRows = (ghlYtdRes.data ?? []) as Array<{ monetary_value: number }>;
  const openRows = (ghlOpenRes.data ?? []) as Array<{ monetary_value: number }>;
  const revenueYtd = ytdWonRows.reduce(
    (s, o) => s + (Number(o.monetary_value) || 0),
    0
  );
  const pipelineValue = openRows.reduce(
    (s, o) => s + (Number(o.monetary_value) || 0),
    0
  );

  // -- Finance
  const plaidAccounts = plaidAccountsRes.data ?? [];
  const plaidTx = plaidTxRes.data ?? [];
  const finance =
    plaidAccounts.length > 0
      ? summarizeFinance(
          plaidAccounts.map((a) => ({
            type: a.type as string | null,
            current_balance: a.current_balance as number | null,
            is_debt: a.is_debt as boolean | null,
            is_active: a.is_active as boolean | null,
          })),
          plaidTx.map((t) => ({
            amount: Number(t.amount),
            date: t.date as string | null,
          }))
        )
      : null;

  // -- Health: today's steps, last sleep, latest weight
  type HealthRow = {
    metric_type: string;
    value: number;
    unit: string | null;
    recorded_at: string;
  };
  const healthRows = (healthRes.data ?? []) as HealthRow[];
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  function dayKey(iso: string): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  }
  const todaySteps = healthRows
    .filter((r) => r.metric_type === "steps" && dayKey(r.recorded_at) === todayKey)
    .reduce((s, r) => s + r.value, 0);
  const lastSleep = healthRows.find((r) => r.metric_type === "sleep_hours");
  const lastWeight = healthRows.find((r) => r.metric_type === "weight");

  // -- Days math
  const yearStartMs = new Date(now.getFullYear(), 0, 1).getTime();
  const dayOfYear = Math.max(
    1,
    Math.round((now.getTime() - yearStartMs) / 86400000)
  );
  const daysLeftInYear = Math.max(
    0,
    Math.ceil(
      (new Date(now.getFullYear() + 1, 0, 1).getTime() - now.getTime()) / 86400000
    )
  );
  const daysToFulltime = Math.max(
    0,
    Math.ceil(
      (new Date("2027-01-01T00:00:00Z").getTime() - now.getTime()) / 86400000
    )
  );

  return (
    <OverviewView
      displayName={profile?.full_name ?? profile?.name ?? user.email?.split("@")[0] ?? "Naldo"}
      now={now.toISOString()}
      dayOfYear={dayOfYear}
      daysLeftInYear={daysLeftInYear}
      daysToFulltime={daysToFulltime}
      revenueYtd={revenueYtd}
      revenueTarget={REVENUE_TARGET_USD}
      pipelineValue={pipelineValue}
      finance={finance}
      debtBaseline={DEBT_BASELINE_USD}
      events={(eventsRes.data ?? []) as Array<{
        id: string;
        title: string;
        starts_at: string;
        all_day: boolean;
        color: string | null;
        source: string;
      }>}
      tasks={(tasksRes.data ?? []) as Array<{
        id: string;
        title: string;
        priority: string | null;
        flagged: boolean;
        status: string | null;
      }>}
      reminders={(remindersRes.data ?? []) as Array<{
        id: string;
        title: string;
        fire_at: string | null;
      }>}
      capturesThisWeek={capturesRes.count ?? 0}
      avoidance={(avoidanceRes.data ?? []) as Array<{
        id: string;
        title: string;
        flagged_at: string;
      }>}
      health={{
        stepsToday: Math.round(todaySteps),
        lastSleepHours: lastSleep ? Number(lastSleep.value) : null,
        lastSleepAt: lastSleep ? lastSleep.recorded_at : null,
        latestWeight: lastWeight
          ? {
              value: Number(lastWeight.value),
              unit: lastWeight.unit,
              recorded_at: lastWeight.recorded_at,
            }
          : null,
      }}
    />
  );
}
