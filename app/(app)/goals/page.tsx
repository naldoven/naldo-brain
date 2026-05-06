import { GoalsView } from "@/components/goals-view";
import { createClient } from "@/lib/supabase/server";
import { DEBT_BASELINE_USD, summarizeFinance } from "@/lib/plaid";

export const dynamic = "force-dynamic";

const REVENUE_TARGET_USD = 500000;

// Pipeline-name keywords → bucket. Naldo named his pipelines "Christmas Lights"
// and "perm" — match liberally so renames don't silently break the cards.
const PIPELINE_BUCKETS: Array<{ key: string; matches: RegExp; target: number; label: string }> = [
  {
    key: "holiday",
    matches: /christmas|holiday|hol\.?\s*light/i,
    target: 50,
    label: "Holiday lighting homes",
  },
  {
    key: "permanent",
    matches: /perm/i,
    target: 6,
    label: "Permanent lighting jobs",
  },
  {
    key: "events",
    matches: /event|wedding/i,
    target: 10,
    label: "Event / wedding jobs",
  },
];

// 2027-01-01 = "go full time on YLL next year"
const YLL_FULLTIME_TARGET = new Date("2027-01-01T00:00:00Z");

export default async function GoalsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const yearStartIso = new Date(new Date().getFullYear(), 0, 1).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);

  const [
    ghlYtdWonRes,
    ghlOpenRes,
    plaidAccountsRes,
    plaidTxRes,
    savingsRes,
  ] = await Promise.all([
      supabase
        .from("gohighlevel_opportunities")
        .select("monetary_value, ghl_status_changed_at, ghl_updated_at, pipeline_name")
        .eq("user_id", user.id)
        .eq("status", "won")
        .or(
          `ghl_status_changed_at.gte.${yearStartIso},and(ghl_status_changed_at.is.null,ghl_updated_at.gte.${yearStartIso})`
        ),
      supabase
        .from("gohighlevel_opportunities")
        .select("monetary_value, pipeline_name, status")
        .eq("user_id", user.id),
      supabase
        .from("plaid_accounts")
        .select("type, current_balance, is_debt, is_active")
        .eq("user_id", user.id)
        .eq("is_active", true),
      supabase
        .from("plaid_transactions")
        .select("amount, date")
        .eq("user_id", user.id)
        .gte("date", thirtyDaysAgo)
        .limit(5000),
      supabase
        .from("savings_goals")
        .select("id, name, target_usd, current_usd, target_date, emoji, accent")
        .eq("user_id", user.id)
        .eq("archived", false)
        .order("position")
        .order("created_at"),
    ]);

  const ghlYtdWon = (ghlYtdWonRes.data ?? []) as Array<{
    monetary_value: number;
    pipeline_name: string | null;
  }>;
  const ghlAll = (ghlOpenRes.data ?? []) as Array<{
    monetary_value: number;
    pipeline_name: string | null;
    status: string | null;
  }>;
  const plaidAccounts = plaidAccountsRes.data ?? [];
  const plaidTx = plaidTxRes.data ?? [];

  // -- Revenue YTD vs $500K
  const revenueYtd = ghlYtdWon.reduce(
    (s, o) => s + (Number(o.monetary_value) || 0),
    0
  );

  // -- Debt-free (uses Plaid baseline $55K)
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

  // -- Service-line counts (won YTD + open) per pipeline bucket
  const serviceLines = PIPELINE_BUCKETS.map((bucket) => {
    const won = ghlYtdWon.filter((o) =>
      o.pipeline_name ? bucket.matches.test(o.pipeline_name) : false
    ).length;
    const open = ghlAll.filter(
      (o) =>
        o.status === "open" &&
        (o.pipeline_name ? bucket.matches.test(o.pipeline_name) : false)
    ).length;
    return {
      key: bucket.key,
      label: bucket.label,
      target: bucket.target,
      won,
      open,
      progress: Math.min(1, won / bucket.target),
    };
  });

  // -- Days to YLL full-time
  const daysToFulltime = Math.max(
    0,
    Math.ceil((YLL_FULLTIME_TARGET.getTime() - Date.now()) / 86400000)
  );

  const savingsGoals = (savingsRes.data ?? []) as Array<{
    id: string;
    name: string;
    target_usd: number;
    current_usd: number;
    target_date: string | null;
    emoji: string | null;
    accent: string | null;
  }>;

  return (
    <GoalsView
      revenueYtd={revenueYtd}
      revenueTarget={REVENUE_TARGET_USD}
      debtPaidOff={finance?.debtPaidOff ?? 0}
      debtBaseline={finance?.debtBaseline ?? DEBT_BASELINE_USD}
      debtTotal={finance?.debtTotal ?? 0}
      hasFinanceData={finance !== null}
      serviceLines={serviceLines}
      daysToFulltime={daysToFulltime}
      savingsGoals={savingsGoals}
    />
  );
}
