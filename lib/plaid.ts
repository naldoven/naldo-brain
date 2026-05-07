/**
 * Plaid client + sync logic.
 *
 * - Single-user MVP: PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV / PLAID_OWNER_USER_ID env vars
 * - Sandbox / Development / Production env switch via PLAID_ENV
 * - access_tokens encrypted at rest with AES-256-GCM via lib/crypto.ts
 *   (PLAID_TOKEN_ENCRYPTION_KEY env var). Pre-encryption rows are
 *   lazily migrated on next sync.
 * - Sync uses /transactions/sync (cursor-incremental) so re-runs are cheap
 *
 * Naldo's $55K business debt baseline lives in PLAID_DEBT_BASELINE_USD; the
 * /finance page + briefings compute (baseline - currentDebt) as "paid off".
 */
import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
  type AccountBase,
  type Transaction,
  type RemovedTransaction,
} from "plaid";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptToken, decryptToken, isEncrypted } from "@/lib/crypto";

// ---- Client construction --------------------------------------------------

function getEnv(): keyof typeof PlaidEnvironments {
  const env = (process.env.PLAID_ENV ?? "sandbox").toLowerCase();
  if (env === "production" || env === "development" || env === "sandbox") {
    return env;
  }
  return "sandbox";
}

export function getPlaidClient(): PlaidApi {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new Error(
      "Plaid not configured — set PLAID_CLIENT_ID and PLAID_SECRET (and PLAID_ENV)"
    );
  }
  const config = new Configuration({
    basePath: PlaidEnvironments[getEnv()],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
        "Plaid-Version": "2020-09-14",
      },
    },
  });
  return new PlaidApi(config);
}

// ---- Public helpers ------------------------------------------------------

/**
 * Plaid SDK errors are axios errors — the structured Plaid error body
 * lives at err.response.data. Surface the error_code + display_message
 * so we get something like "INVALID_REDIRECT_URI: this URI is not in
 * the allowlist" instead of a generic "Request failed with status 400".
 */
function plaidErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "response" in err) {
    const data = (err as { response?: { data?: unknown } }).response?.data as
      | {
          error_code?: string;
          error_message?: string;
          error_type?: string;
          display_message?: string;
        }
      | undefined;
    if (data) {
      const code = data.error_code ?? "PLAID_ERROR";
      const msg = data.display_message ?? data.error_message ?? "no message";
      return `${code} — ${msg}`;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Generate a link_token for the frontend to launch Plaid Link.
 *
 * `redirectUri` is REQUIRED for OAuth banks in Production (Chase, BofA,
 * Wells Fargo, Capital One, etc.). The bank redirects the entire window
 * to this URI after the user authenticates; the frontend then resumes
 * Plaid Link with `receivedRedirectUri` set. Must also be registered in
 * the Plaid dashboard → Team Settings → API → Allowed redirect URIs.
 */
export async function createLinkToken(
  userId: string,
  redirectUri?: string
): Promise<string> {
  const client = getPlaidClient();
  try {
    const res = await client.linkTokenCreate({
      user: { client_user_id: userId },
      client_name: "Naldo's Brain",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
      redirect_uri: redirectUri,
    });
    return res.data.link_token;
  } catch (err) {
    throw new Error(`linkTokenCreate: ${plaidErrorMessage(err)}`);
  }
}

/**
 * Exchange a Plaid public_token (from Link onSuccess) for a long-lived
 * access_token, then persist the item row + initial accounts.
 */
export async function exchangePublicToken(
  supabase: SupabaseClient,
  userId: string,
  publicToken: string
): Promise<{ itemId: string; institutionName: string | null }> {
  const client = getPlaidClient();
  const exchange = await client.itemPublicTokenExchange({ public_token: publicToken });
  const accessToken = exchange.data.access_token;
  const externalItemId = exchange.data.item_id;

  // Pull institution metadata so the UI can label the connection
  let institutionName: string | null = null;
  let institutionId: string | null = null;
  try {
    const item = await client.itemGet({ access_token: accessToken });
    institutionId = item.data.item.institution_id ?? null;
    if (institutionId) {
      const inst = await client.institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      });
      institutionName = inst.data.institution.name ?? null;
    }
  } catch {
    // Non-fatal — we'll still save the item without the pretty label.
  }

  // Encrypt before storing — PLAID_TOKEN_ENCRYPTION_KEY must be set.
  const accessTokenAtRest = encryptToken(accessToken);

  // Upsert the item
  const { data: existing } = await supabase
    .from("plaid_items")
    .select("id")
    .eq("user_id", userId)
    .eq("external_item_id", externalItemId)
    .maybeSingle();

  let itemRowId: string;
  if (existing) {
    const { data: updated } = await supabase
      .from("plaid_items")
      .update({
        access_token: accessTokenAtRest,
        institution_id: institutionId,
        institution_name: institutionName,
        status: "ok",
        status_detail: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("id")
      .single();
    itemRowId = updated!.id;
  } else {
    const { data: inserted, error } = await supabase
      .from("plaid_items")
      .insert({
        user_id: userId,
        external_item_id: externalItemId,
        access_token: accessTokenAtRest,
        institution_id: institutionId,
        institution_name: institutionName,
      })
      .select("id")
      .single();
    if (error) throw new Error(`item insert: ${error.message}`);
    itemRowId = inserted!.id;
  }

  // Pull initial account list so the UI has something to show immediately
  await syncAccountsForItem(supabase, userId, itemRowId, accessToken);

  return { itemId: itemRowId, institutionName };
}

/**
 * Disconnect: remove the Plaid Item upstream and delete the local row
 * (cascades accounts + transactions).
 */
export async function disconnectItem(
  supabase: SupabaseClient,
  userId: string,
  itemRowId: string
): Promise<void> {
  const { data: item } = await supabase
    .from("plaid_items")
    .select("id, access_token")
    .eq("id", itemRowId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!item) return;

  try {
    const client = getPlaidClient();
    // The stored value is encrypted (post-migration) or plaintext (legacy);
    // decryptToken() handles both transparently.
    const accessToken = decryptToken(item.access_token);
    await client.itemRemove({ access_token: accessToken });
  } catch {
    // Even if remove fails upstream, delete locally so user isn't stuck.
  }

  await supabase.from("plaid_items").delete().eq("id", item.id);
}

// ---- Sync ----------------------------------------------------------------

const DEBT_TYPES = new Set(["credit", "loan"]);

/**
 * Pull current account balances + types and upsert into plaid_accounts.
 */
async function syncAccountsForItem(
  supabase: SupabaseClient,
  userId: string,
  itemRowId: string,
  accessToken: string
): Promise<{ accountsSeen: number; error?: string }> {
  const client = getPlaidClient();
  let accounts: AccountBase[];
  try {
    const res = await client.accountsGet({ access_token: accessToken });
    accounts = res.data.accounts;
  } catch (err) {
    return {
      accountsSeen: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  for (const a of accounts) {
    const isDebt = DEBT_TYPES.has(a.type);
    const payload = {
      user_id: userId,
      item_id: itemRowId,
      external_id: a.account_id,
      name: a.name ?? null,
      official_name: a.official_name ?? null,
      type: a.type ?? null,
      subtype: a.subtype ?? null,
      mask: a.mask ?? null,
      current_balance: a.balances.current ?? null,
      available_balance: a.balances.available ?? null,
      iso_currency_code: a.balances.iso_currency_code ?? null,
      is_debt: isDebt,
      is_active: true,
      raw: a as unknown as Record<string, unknown>,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("plaid_accounts")
      .upsert(payload, { onConflict: "user_id,external_id" });
    if (error) {
      console.error("[plaid] account upsert", a.account_id, error.message);
    }
  }

  return { accountsSeen: accounts.length };
}

/**
 * Pull transactions via /transactions/sync. This is incremental — Plaid
 * returns added/modified/removed since the cursor we last stored.
 */
async function syncTransactionsForItem(
  supabase: SupabaseClient,
  userId: string,
  itemRowId: string,
  accessToken: string,
  startCursor: string | null
): Promise<{
  added: number;
  modified: number;
  removed: number;
  newCursor: string | null;
  error?: string;
}> {
  const client = getPlaidClient();

  // Build account_id (uuid) lookup so we can attach our local FK.
  const { data: accountRows } = await supabase
    .from("plaid_accounts")
    .select("id, external_id")
    .eq("user_id", userId)
    .eq("item_id", itemRowId);
  const accountUuidByExternal = new Map<string, string>();
  for (const r of accountRows ?? []) {
    accountUuidByExternal.set(r.external_id as string, r.id as string);
  }

  let added = 0;
  let modified = 0;
  let removed = 0;
  let cursor: string | null = startCursor;
  let hasMore = true;

  while (hasMore) {
    let resp: {
      added: Transaction[];
      modified: Transaction[];
      removed: RemovedTransaction[];
      next_cursor: string;
      has_more: boolean;
    };
    try {
      const res = await client.transactionsSync({
        access_token: accessToken,
        cursor: cursor ?? undefined,
      });
      resp = res.data;
    } catch (err) {
      return {
        added,
        modified,
        removed,
        newCursor: cursor,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // Apply added + modified as upserts
    const writes = [...resp.added, ...resp.modified];
    if (writes.length > 0) {
      const rows = writes.map((t) => ({
        user_id: userId,
        item_id: itemRowId,
        account_id: accountUuidByExternal.get(t.account_id) ?? null,
        external_id: t.transaction_id,
        amount: t.amount,
        iso_currency_code: t.iso_currency_code ?? null,
        date: t.date ?? null,
        authorized_date: t.authorized_date ?? null,
        name: t.name ?? null,
        merchant_name: t.merchant_name ?? null,
        category: t.category ?? null,
        pending: t.pending ?? false,
        payment_channel: t.payment_channel ?? null,
        raw: t as unknown as Record<string, unknown>,
      }));
      const CHUNK = 250;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("plaid_transactions")
          .upsert(chunk, { onConflict: "user_id,external_id" });
        if (error) {
          console.error("[plaid] tx upsert", error.message);
        }
      }
    }

    // Removed transactions
    if (resp.removed.length > 0) {
      const ids = resp.removed.map((r) => r.transaction_id).filter(Boolean) as string[];
      if (ids.length > 0) {
        const { error } = await supabase
          .from("plaid_transactions")
          .delete()
          .eq("user_id", userId)
          .in("external_id", ids);
        if (error) console.error("[plaid] tx remove", error.message);
      }
    }

    added += resp.added.length;
    modified += resp.modified.length;
    removed += resp.removed.length;
    cursor = resp.next_cursor;
    hasMore = resp.has_more;
  }

  return { added, modified, removed, newCursor: cursor };
}

/**
 * Sync every Plaid Item belonging to this user. Called by the cron worker.
 */
export async function syncFromPlaid(
  supabase: SupabaseClient,
  userId: string
): Promise<{
  items: number;
  accountsSeen: number;
  transactionsAdded: number;
  transactionsModified: number;
  transactionsRemoved: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let accountsSeen = 0;
  let txAdded = 0;
  let txModified = 0;
  let txRemoved = 0;

  const { data: items } = await supabase
    .from("plaid_items")
    .select("id, access_token, transactions_cursor")
    .eq("user_id", userId);

  for (const it of items ?? []) {
    const stored = it.access_token as string;

    // Lazy migration: if a row was created before encryption was wired up,
    // it's plaintext. Encrypt and update the row in-place. We continue using
    // the plaintext value for THIS run's API calls (avoids a useless extra
    // decrypt round-trip). Subsequent runs will go through decryptToken.
    let accessToken: string;
    if (isEncrypted(stored)) {
      try {
        accessToken = decryptToken(stored);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`decrypt ${it.id}: ${msg}`);
        await supabase
          .from("plaid_items")
          .update({
            status: "error",
            status_detail: `decrypt failed: ${msg}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", it.id);
        continue;
      }
    } else {
      accessToken = stored;
      try {
        const encrypted = encryptToken(accessToken);
        await supabase
          .from("plaid_items")
          .update({
            access_token: encrypted,
            updated_at: new Date().toISOString(),
          })
          .eq("id", it.id);
      } catch (err) {
        // If encryption fails (missing key etc.), don't break the sync —
        // just log and continue with plaintext for this run. The user will
        // see the encryption error on the next request that uses the key.
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`encrypt ${it.id}: ${msg}`);
      }
    }

    // Refresh accounts
    const a = await syncAccountsForItem(
      supabase,
      userId,
      it.id as string,
      accessToken
    );
    accountsSeen += a.accountsSeen;
    if (a.error) {
      errors.push(`accounts ${it.id}: ${a.error}`);
      // If accounts call failed (e.g. login_required), skip transactions for this item.
      await supabase
        .from("plaid_items")
        .update({
          status: "login_required",
          status_detail: a.error,
          updated_at: new Date().toISOString(),
        })
        .eq("id", it.id);
      continue;
    }

    // Sync transactions
    const t = await syncTransactionsForItem(
      supabase,
      userId,
      it.id as string,
      accessToken,
      (it.transactions_cursor as string | null) ?? null
    );
    txAdded += t.added;
    txModified += t.modified;
    txRemoved += t.removed;
    if (t.error) errors.push(`transactions ${it.id}: ${t.error}`);

    // Persist new cursor + last_synced_at
    await supabase
      .from("plaid_items")
      .update({
        transactions_cursor: t.newCursor,
        status: t.error ? "error" : "ok",
        status_detail: t.error ?? null,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", it.id);
  }

  return {
    items: (items ?? []).length,
    accountsSeen,
    transactionsAdded: txAdded,
    transactionsModified: txModified,
    transactionsRemoved: txRemoved,
    errors,
  };
}

// ---- Debt + cash summaries (consumed by /finance + briefings) ------------

export const DEBT_BASELINE_USD = Number(
  process.env.PLAID_DEBT_BASELINE_USD ?? 55000
);

export type FinanceSnapshot = {
  cashTotal: number;            // sum of depository accounts
  debtTotal: number;            // sum of credit + loan account balances (positive number)
  debtPaidOff: number;          // baseline - debtTotal (clamped >= 0)
  debtBaseline: number;         // configured baseline ($55K for Naldo)
  debtPctPaid: number;          // 0..1
  netLiquid: number;            // cashTotal - debtTotal
  burn30d: number;              // sum of outflows (positive amounts) in last 30 days
  income30d: number;            // sum of inflows (negative amounts negated) in last 30 days
  netFlow30d: number;           // income - burn
};

type AccountForSummary = {
  type: string | null;
  current_balance: number | null;
  is_debt: boolean | null;
  is_active: boolean | null;
};

type TxForSummary = {
  amount: number;
  date: string | null;
};

export function summarizeFinance(
  accounts: AccountForSummary[],
  recentTransactions: TxForSummary[],
  options: { baseline?: number } = {}
): FinanceSnapshot {
  // The baseline is the "starting debt" we measure payoff against. Defaults to
  // $55K (the business-debt goal). Pass `baseline: 0` for the Personal scope
  // — there's no payoff target there, the snapshot just shows current balances.
  const baseline = Math.max(0, options.baseline ?? DEBT_BASELINE_USD);

  let cashTotal = 0;
  let debtTotal = 0;
  for (const a of accounts) {
    if (a.is_active === false) continue;
    const bal = Number(a.current_balance ?? 0);
    if (a.is_debt) {
      // Plaid reports credit balances as positive (amount you owe), so we sum
      // directly. Loan accounts use the same convention.
      debtTotal += Math.abs(bal);
    } else if (a.type === "depository") {
      cashTotal += bal;
    }
  }

  const debtPaidOff = Math.max(0, baseline - debtTotal);
  const debtPctPaid =
    baseline > 0 ? Math.max(0, Math.min(1, debtPaidOff / baseline)) : 0;

  let burn30d = 0;
  let income30d = 0;
  for (const t of recentTransactions) {
    const amt = Number(t.amount);
    if (!Number.isFinite(amt)) continue;
    if (amt > 0) burn30d += amt;
    else income30d += -amt;
  }

  return {
    cashTotal: round2(cashTotal),
    debtTotal: round2(debtTotal),
    debtPaidOff: round2(debtPaidOff),
    debtBaseline: baseline,
    debtPctPaid: +debtPctPaid.toFixed(3),
    netLiquid: round2(cashTotal - debtTotal),
    burn30d: round2(burn30d),
    income30d: round2(income30d),
    netFlow30d: round2(income30d - burn30d),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
