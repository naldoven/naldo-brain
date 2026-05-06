import { FinanceView } from "@/components/finance-view";
import { createClient } from "@/lib/supabase/server";
import { DEBT_BASELINE_USD, summarizeFinance } from "@/lib/plaid";

export const dynamic = "force-dynamic";

type AccountRow = {
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
};

type ItemRow = {
  id: string;
  institution_name: string | null;
  status: string;
  status_detail: string | null;
  last_synced_at: string | null;
};

type TxRow = {
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

  const [itemsRes, accountsRes, txRes] = await Promise.all([
    supabase
      .from("plaid_items")
      .select("id, institution_name, status, status_detail, last_synced_at")
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
      .limit(200),
  ]);

  const items = (itemsRes.data ?? []) as ItemRow[];
  const accounts = (accountsRes.data ?? []) as AccountRow[];
  const transactions = (txRes.data ?? []) as TxRow[];

  const snapshot = summarizeFinance(
    accounts.map((a) => ({
      type: a.type,
      current_balance: a.current_balance,
      is_debt: a.is_debt,
      is_active: a.is_active,
    })),
    transactions.map((t) => ({ amount: t.amount, date: t.date }))
  );

  return (
    <FinanceView
      items={items}
      accounts={accounts}
      transactions={transactions}
      snapshot={snapshot}
      debtBaseline={DEBT_BASELINE_USD}
    />
  );
}
