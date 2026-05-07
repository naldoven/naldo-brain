import { FinanceView } from "@/components/finance-view";
import { createClient } from "@/lib/supabase/server";
import { DEBT_BASELINE_USD, summarizeFinance } from "@/lib/plaid";

export const dynamic = "force-dynamic";

export type Scope = "business" | "personal";

export type AccountRow = {
  id: string;
  name: string | null;
  official_name: string | null;
  type: string | null;
  subtype: string | null;
  mask: string | null;
  current_balance: number | null;
  available_balance: number | null;
  iso_currency_code: string | null;
  is_debt: boolean | null;
  is_active: boolean | null;
  item_id: string;
  scope: Scope;
};

export type ItemRow = {
  id: string;
  institution_name: string | null;
  status: string;
  status_detail: string | null;
  last_synced_at: string | null;
  scope: Scope;
};

export type TxRow = {
  id: string;
  amount: number;
  iso_currency_code: string | null;
  date: string | null;
  authorized_date: string | null;
  name: string | null;
  merchant_name: string | null;
  category: string[] | null;
  pending: boolean;
  account_id: string | null;
  scope: Scope;
};

export default async function FinancePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);

  const [itemsRes, accountsRes, txRes, savingsRes] = await Promise.all([
    supabase
      .from("plaid_items")
      .select("id, institution_name, status, status_detail, last_synced_at, scope")
      .eq("user_id", user.id)
      .order("created_at"),
    supabase
      .from("plaid_accounts")
      .select(
        "id, name, official_name, type, subtype, mask, current_balance, available_balance, iso_currency_code, is_debt, is_active, item_id"
      )
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("type"),
    supabase
      .from("plaid_transactions")
      .select(
        "id, amount, iso_currency_code, date, authorized_date, name, merchant_name, category, pending, account_id"
      )
      .eq("user_id", user.id)
      .gte("date", thirtyDaysAgo)
      .order("date", { ascending: false })
      .limit(500),
    supabase
      .from("savings_goals")
      .select("id, name, target_usd, current_usd, target_date, emoji, accent, archived, completed_at")
      .eq("user_id", user.id)
      .eq("archived", false)
      .order("position")
      .order("created_at"),
  ]);

  // Tag every account + transaction with its item's scope so the view can
  // filter without an extra round-trip. Default 'personal' if anything
  // is somehow null (defensive — column has a default).
  const itemScopeById = new Map<string, Scope>();
  const items: ItemRow[] = (itemsRes.data ?? []).map((i) => {
    const scope: Scope = (i.scope as Scope) ?? "personal";
    itemScopeById.set(i.id as string, scope);
    return { ...(i as Omit<ItemRow, "scope">), scope };
  });

  const accountScopeById = new Map<string, Scope>();
  const accounts: AccountRow[] = (accountsRes.data ?? []).map((a) => {
    const scope: Scope = itemScopeById.get(a.item_id as string) ?? "personal";
    accountScopeById.set(a.id as string, scope);
    return { ...(a as Omit<AccountRow, "scope">), scope };
  });

  const transactions: TxRow[] = (txRes.data ?? []).map((t) => {
    const scope: Scope = t.account_id
      ? accountScopeById.get(t.account_id as string) ?? "personal"
      : "personal";
    return { ...(t as Omit<TxRow, "scope">), scope };
  });

  // Compute per-scope snapshots. Business uses the $55K baseline (the
  // configured payoff target). Personal uses 0 — we don't track a personal-
  // debt-payoff goal, just the live balances.
  function snapshotFor(scope: Scope) {
    const a = accounts.filter((x) => x.scope === scope);
    const t = transactions.filter((x) => x.scope === scope);
    return summarizeFinance(
      a.map((x) => ({
        type: x.type,
        current_balance: x.current_balance,
        is_debt: x.is_debt,
        is_active: x.is_active,
      })),
      t.map((x) => ({ amount: x.amount, date: x.date })),
      { baseline: scope === "business" ? DEBT_BASELINE_USD : 0 }
    );
  }

  const businessSnapshot = snapshotFor("business");
  const personalSnapshot = snapshotFor("personal");

  const savings = (savingsRes.data ?? []) as Array<{
    id: string;
    name: string;
    target_usd: number;
    current_usd: number;
    target_date: string | null;
    emoji: string | null;
    accent: string | null;
    archived: boolean;
    completed_at: string | null;
  }>;

  return (
    <FinanceView
      items={items}
      accounts={accounts}
      transactions={transactions}
      businessSnapshot={businessSnapshot}
      personalSnapshot={personalSnapshot}
      debtBaseline={DEBT_BASELINE_USD}
      savingsGoals={savings}
    />
  );
}
