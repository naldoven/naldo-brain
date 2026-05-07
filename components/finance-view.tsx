"use client";

import { useMemo } from "react";
import {
  Wallet,
  TrendingDown,
  TrendingUp,
  CreditCard,
  Building2,
  ArrowDownRight,
  ArrowUpRight,
  Briefcase,
  User,
} from "lucide-react";
import type { FinanceSnapshot } from "@/lib/plaid";
import type { Scope, AccountRow, ItemRow, TxRow } from "@/app/(app)/finance/page";
import { SavingsGoals, type SavingsGoal } from "@/components/savings-goals";

type Props = {
  items: ItemRow[];
  accounts: AccountRow[];
  transactions: TxRow[];
  businessSnapshot: FinanceSnapshot;
  personalSnapshot: FinanceSnapshot;
  debtBaseline: number;
  savingsGoals: SavingsGoal[];
};

const TZ = "America/New_York";

function fmtUsd(n: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    notation: opts.compact ? "compact" : "standard",
    maximumFractionDigits: opts.compact ? 1 : 0,
  });
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(`${s}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
  });
}

export function FinanceView({
  items,
  accounts,
  transactions,
  businessSnapshot,
  personalSnapshot,
  debtBaseline,
  savingsGoals,
}: Props) {
  const empty = items.length === 0;

  const itemById = useMemo(() => {
    const m = new Map<string, ItemRow>();
    for (const i of items) m.set(i.id, i);
    return m;
  }, [items]);

  return (
    <div>
      <div className="flex justify-between items-start mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Wallet className="size-7" /> Finance
          </h1>
          <p className="text-zinc-400">
            Plaid · synced every 6 hours.{" "}
            {empty && (
              <a href="/integrations" className="text-indigo-400 hover:underline">
                Connect a bank →
              </a>
            )}
          </p>
        </div>
      </div>

      {empty && <EmptyState />}

      <ScopeSection
        scope="personal"
        title="Personal"
        subtitle="Personal accounts. The $55K debt-free goal lives here."
        snapshot={personalSnapshot}
        debtBaseline={debtBaseline}
        accounts={accounts.filter((a) => a.scope === "personal")}
        transactions={transactions.filter((t) => t.scope === "personal")}
        itemById={itemById}
        showHero
      />

      <div className="my-6 border-t border-white/5" />

      <ScopeSection
        scope="business"
        title="Business"
        subtitle="YLL accounts — cash flow + balances (no debt to pay off)."
        snapshot={businessSnapshot}
        debtBaseline={0}
        accounts={accounts.filter((a) => a.scope === "business")}
        transactions={transactions.filter((t) => t.scope === "business")}
        itemById={itemById}
        showHero={false}
      />

      {/* Savings goals — scope-agnostic for now */}
      <div className="mt-8">
        <SavingsGoals goals={savingsGoals} />
      </div>

      {/* Connection status footer */}
      {items.length > 0 && (
        <div className="mt-6 text-[11px] text-zinc-500 flex flex-wrap gap-3">
          {items.map((it) => (
            <span key={it.id} className="inline-flex items-center gap-1.5">
              <span
                className={`size-1.5 rounded-full ${
                  it.status === "ok" ? "bg-emerald-400" : "bg-amber-400"
                }`}
              />
              {it.institution_name ?? "Connection"} · {it.scope} · {it.status}
              {it.last_synced_at
                ? ` · last sync ${fmtDate(it.last_synced_at.slice(0, 10))}`
                : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- subcomponents -------------------------------------------------

function ScopeSection({
  scope,
  title,
  subtitle,
  snapshot,
  debtBaseline,
  accounts,
  transactions,
  itemById,
  showHero,
}: {
  scope: Scope;
  title: string;
  subtitle: string;
  snapshot: FinanceSnapshot;
  debtBaseline: number;
  accounts: AccountRow[];
  transactions: TxRow[];
  itemById: Map<string, ItemRow>;
  showHero: boolean;
}) {
  const Icon = scope === "business" ? Briefcase : User;
  const cashAccounts = accounts.filter(
    (a) => a.type === "depository" && a.is_active !== false
  );
  const debtAccounts = accounts.filter((a) => a.is_debt && a.is_active !== false);

  const empty = accounts.length === 0;

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Icon className="size-5 text-zinc-300" />
          <h2 className="text-xl font-bold">{title}</h2>
        </div>
        <p className="text-xs text-zinc-500">{subtitle}</p>
      </div>

      {empty ? (
        <div className="glass rounded-2xl p-5 border border-dashed border-white/10 text-sm text-zinc-400 mb-2">
          No {scope} accounts connected.{" "}
          <a href="/integrations" className="text-indigo-300 hover:underline">
            Connect or tag one →
          </a>
        </div>
      ) : (
        <>
          {showHero && (
            <div className="glass-strong rounded-2xl p-6 mb-4 bg-gradient-to-br from-emerald-500/15 via-amber-500/10 to-rose-500/15 border border-white/10">
              <div className="flex items-start justify-between gap-6 flex-wrap">
                <div>
                  <div className="text-xs text-zinc-400 flex items-center gap-2 mb-1">
                    <TrendingDown className="size-3.5" /> Debt payoff
                  </div>
                  <div className="text-4xl font-bold">
                    {fmtUsd(snapshot.debtPaidOff)}{" "}
                    <span className="text-zinc-500 font-normal text-2xl">
                      / {fmtUsd(debtBaseline, { compact: true })}
                    </span>
                  </div>
                  <div className="text-sm text-zinc-400 mt-1">
                    {(snapshot.debtPctPaid * 100).toFixed(1)}% paid ·{" "}
                    {fmtUsd(snapshot.debtTotal, { compact: true })} remaining
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-zinc-400">Net liquid</div>
                  <div className="text-2xl font-semibold">
                    {fmtUsd(snapshot.netLiquid, { compact: true })}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-1">cash − debt</div>
                </div>
              </div>
              <div className="mt-5 h-3 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500 transition-all"
                  style={{ width: `${snapshot.debtPctPaid * 100}%` }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <KpiCard
              icon={Building2}
              label="Cash on hand"
              value={fmtUsd(snapshot.cashTotal, { compact: true })}
              sub={`${cashAccounts.length} ${cashAccounts.length === 1 ? "account" : "accounts"}`}
              accent="from-emerald-500/20 to-emerald-500/5"
            />
            <KpiCard
              icon={CreditCard}
              label="Debt"
              value={fmtUsd(snapshot.debtTotal, { compact: true })}
              sub={`${debtAccounts.length} ${debtAccounts.length === 1 ? "account" : "accounts"}`}
              accent="from-rose-500/20 to-rose-500/5"
            />
            <KpiCard
              icon={snapshot.netFlow30d >= 0 ? TrendingUp : TrendingDown}
              label="30-day flow"
              value={fmtUsd(snapshot.netFlow30d, { compact: true })}
              sub={`+${fmtUsd(snapshot.income30d, { compact: true })} in / -${fmtUsd(snapshot.burn30d, { compact: true })} out`}
              accent={
                snapshot.netFlow30d >= 0
                  ? "from-emerald-500/20 to-emerald-500/5"
                  : "from-amber-500/20 to-amber-500/5"
              }
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
            <div className="glass-strong rounded-2xl p-5">
              <h3 className="font-bold text-sm mb-3">Accounts</h3>
              <div className="space-y-2">
                {accounts.map((a) => {
                  const item = itemById.get(a.item_id);
                  const balance = Number(a.current_balance ?? 0);
                  const isDebt = !!a.is_debt;
                  return (
                    <div
                      key={a.id}
                      className="flex items-center justify-between gap-3 p-3 rounded-lg hover:bg-white/5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-sm truncate">
                          {a.name || a.official_name || "(unnamed account)"}
                          {a.mask ? (
                            <span className="text-zinc-500 font-normal">
                              {" "}
                              ··{a.mask}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[11px] text-zinc-500 truncate">
                          {item?.institution_name ?? "—"} ·{" "}
                          {a.subtype ?? a.type ?? "account"}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div
                          className={`text-sm font-semibold ${
                            isDebt ? "text-rose-300" : "text-emerald-300"
                          }`}
                        >
                          {isDebt ? "-" : ""}
                          {fmtUsd(Math.abs(balance), { compact: true })}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          {isDebt ? "owed" : a.iso_currency_code ?? "USD"}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="glass-strong rounded-2xl p-5">
              <h3 className="font-bold text-sm mb-3">Recent transactions</h3>
              {transactions.length === 0 ? (
                <p className="text-xs text-zinc-500">No recent transactions.</p>
              ) : (
                <div className="space-y-1">
                  {transactions.slice(0, 12).map((t) => {
                    const isOutflow = t.amount > 0;
                    return (
                      <div
                        key={t.id}
                        className="flex items-center justify-between gap-2 py-2 border-b border-white/5 last:border-0"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold truncate flex items-center gap-1">
                            {isOutflow ? (
                              <ArrowUpRight className="size-3 text-rose-400 shrink-0" />
                            ) : (
                              <ArrowDownRight className="size-3 text-emerald-400 shrink-0" />
                            )}
                            {t.merchant_name ?? t.name ?? "(unknown)"}
                          </div>
                          <div className="text-[10px] text-zinc-500 truncate">
                            {fmtDate(t.date)}
                            {t.pending ? " · pending" : ""}
                            {t.category && t.category.length > 0
                              ? ` · ${t.category[0]}`
                              : ""}
                          </div>
                        </div>
                        <div
                          className={`text-xs font-semibold shrink-0 ${
                            isOutflow ? "text-rose-300" : "text-emerald-300"
                          }`}
                        >
                          {isOutflow ? "-" : "+"}
                          {fmtUsd(Math.abs(t.amount), { compact: true })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  accent: string;
}) {
  return (
    <div
      className={`glass rounded-2xl p-4 bg-gradient-to-br ${accent} border border-white/10`}
    >
      <div className="flex items-center gap-2 text-xs text-zinc-300">
        <Icon className="size-4" />
        {label}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      <div className="text-[11px] text-zinc-400 mt-0.5">{sub}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="glass-strong rounded-2xl p-6 mb-6 border border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 to-pink-500/10">
      <h2 className="font-bold text-lg mb-2">Connect a bank account</h2>
      <p className="text-sm text-zinc-300 mb-3">
        Plaid links your bank, credit cards, and loans so the dashboard can
        track cash, debt payoff progress, and 30-day cash flow automatically.
        After connecting, tag each one as Business or Personal on{" "}
        <a href="/integrations" className="text-indigo-300 underline">/integrations</a>.
      </p>
      <a
        href="/integrations"
        className="inline-flex items-center gap-1 text-sm text-indigo-300 hover:text-indigo-200 underline"
      >
        Set up Plaid →
      </a>
    </div>
  );
}
