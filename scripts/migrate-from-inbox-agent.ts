/**
 * One-shot data migration: copy labels (and optionally sender_rules,
 * style_overrides) from the legacy inbox-agent Supabase project into
 * naldo-brain's email_* tables.
 *
 * The script is idempotent — re-running it just updates rows in place
 * (uses upsert with the unique constraints on each table).
 *
 * Setup
 * -----
 * Required env vars (set inline in terminal OR add to .env.local):
 *
 *   OLD_SUPABASE_URL=https://<old-project>.supabase.co
 *   OLD_SUPABASE_SERVICE_ROLE_KEY=<old-project's service role key>
 *   NEXT_PUBLIC_SUPABASE_URL=https://<naldo-brain>.supabase.co     ← already in .env.local
 *   SUPABASE_SERVICE_ROLE_KEY=<naldo-brain's service role key>     ← already in .env.local
 *   NALDO_USER_ID=<auth.users.id of your user in naldo-brain>
 *
 * Find NALDO_USER_ID:
 *   Naldo-brain Supabase Dashboard → Authentication → Users → your user → "User UID"
 *
 * Find OLD_SUPABASE_* values:
 *   Inbox-agent Supabase Dashboard → Project Settings → API
 *   Or: peek at the Render env on the inbox-agent service
 *
 * Run
 * ---
 *   npx tsx --env-file=.env.local scripts/migrate-from-inbox-agent.ts
 *
 * (If the --env-file flag isn't supported by your tsx version, set the
 * naldo-brain vars manually before running, or extract them from
 * .env.local with a one-liner.)
 *
 * To migrate sender_rules or style_overrides too, change the calls at
 * the bottom of main() — they're written but commented out by default.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const OLD_URL = process.env.OLD_SUPABASE_URL;
const OLD_KEY = process.env.OLD_SUPABASE_SERVICE_ROLE_KEY;
const NEW_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const NEW_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER_ID = process.env.NALDO_USER_ID;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`❌ Missing env var: ${name}`);
    console.error(`   See script header for instructions.`);
    process.exit(1);
  }
  return value;
}

const oldUrl = requireEnv("OLD_SUPABASE_URL", OLD_URL);
const oldKey = requireEnv("OLD_SUPABASE_SERVICE_ROLE_KEY", OLD_KEY);
const newUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL", NEW_URL);
const newKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY", NEW_KEY);
const userId = requireEnv("NALDO_USER_ID", USER_ID);

const old = createClient(oldUrl, oldKey, { auth: { persistSession: false } });
const next = createClient(newUrl, newKey, { auth: { persistSession: false } });

// --- Helpers ---------------------------------------------------------------

async function loadAccountMap(): Promise<Map<string, string>> {
  const { data, error } = await next
    .from("email_accounts")
    .select("id, email_address")
    .eq("user_id", userId);
  if (error) throw new Error(`naldo-brain email_accounts: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      "No email_accounts in naldo-brain for this user. Connect Gmail accounts first via /inbox/settings.",
    );
  }
  const map = new Map<string, string>();
  for (const a of data) map.set(a.email_address.toLowerCase(), a.id);
  console.log(
    `📬 naldo-brain accounts (${data.length}): ${data
      .map((a) => a.email_address)
      .join(", ")}`,
  );
  return map;
}

// --- Migrators -------------------------------------------------------------

async function migrateLabels(accMap: Map<string, string>): Promise<void> {
  console.log("\n=== labels ===");
  const { data: oldLabels, error } = await old
    .from("labels")
    .select("name, description, gmail_label_id, default_action, sort_order, accounts(email_address)");
  if (error) throw new Error(`old labels: ${error.message}`);
  const list = (oldLabels || []) as Array<{
    name: string;
    description: string | null;
    gmail_label_id: string | null;
    default_action: string;
    sort_order: number | null;
    accounts: { email_address: string } | { email_address: string }[] | null;
  }>;
  console.log(`Found ${list.length} labels in inbox-agent.`);

  const rows: Record<string, unknown>[] = [];
  const skipped: string[] = [];
  for (const l of list) {
    const acc = Array.isArray(l.accounts) ? l.accounts[0] : l.accounts;
    const email = acc?.email_address?.toLowerCase();
    if (!email) {
      skipped.push(`${l.name} (no account email in old row)`);
      continue;
    }
    const newAccId = accMap.get(email);
    if (!newAccId) {
      skipped.push(`${l.name} (account ${email} not connected in naldo-brain)`);
      continue;
    }
    rows.push({
      user_id: userId,
      account_id: newAccId,
      name: l.name,
      description: l.description ?? "",
      gmail_label_id: l.gmail_label_id,
      default_action: l.default_action,
      sort_order: l.sort_order ?? 0,
    });
  }

  if (skipped.length) {
    console.log(`Skipped ${skipped.length}:`);
    for (const s of skipped) console.log(`  - ${s}`);
  }
  if (rows.length === 0) {
    console.log("Nothing to import.");
    return;
  }

  console.log(`Upserting ${rows.length} labels…`);
  const { data, error: insertErr } = await next
    .from("email_labels")
    .upsert(rows, { onConflict: "account_id,name" })
    .select();
  if (insertErr) throw new Error(`upsert labels: ${insertErr.message}`);
  console.log(`✅ labels imported: ${data?.length ?? 0}`);
}

async function migrateSenderRules(accMap: Map<string, string>): Promise<void> {
  console.log("\n=== sender_rules ===");
  const { data: oldRules, error } = await old
    .from("sender_rules")
    .select("sender_pattern, pattern_type, action, reason, accounts(email_address)");
  if (error) throw new Error(`old sender_rules: ${error.message}`);
  const list = (oldRules || []) as Array<{
    sender_pattern: string;
    pattern_type: string;
    action: string;
    reason: string | null;
    accounts: { email_address: string } | { email_address: string }[] | null;
  }>;
  console.log(`Found ${list.length} sender_rules in inbox-agent.`);

  const rows: Record<string, unknown>[] = [];
  const skipped: string[] = [];
  for (const r of list) {
    const acc = Array.isArray(r.accounts) ? r.accounts[0] : r.accounts;
    const email = acc?.email_address?.toLowerCase();
    if (!email) {
      skipped.push(`${r.sender_pattern} (no account email)`);
      continue;
    }
    const newAccId = accMap.get(email);
    if (!newAccId) {
      skipped.push(`${r.sender_pattern} (account ${email} not connected)`);
      continue;
    }
    rows.push({
      user_id: userId,
      account_id: newAccId,
      sender_pattern: r.sender_pattern,
      pattern_type: r.pattern_type,
      action: r.action,
      reason: r.reason,
    });
  }

  if (skipped.length) {
    console.log(`Skipped ${skipped.length}:`);
    for (const s of skipped) console.log(`  - ${s}`);
  }
  if (rows.length === 0) {
    console.log("Nothing to import.");
    return;
  }

  console.log(`Upserting ${rows.length} sender_rules…`);
  const { data, error: insertErr } = await next
    .from("email_sender_rules")
    .upsert(rows, { onConflict: "account_id,sender_pattern,pattern_type" })
    .select();
  if (insertErr) throw new Error(`upsert sender_rules: ${insertErr.message}`);
  console.log(`✅ sender_rules imported: ${data?.length ?? 0}`);
}

async function migrateStyleOverrides(accMap: Map<string, string>): Promise<void> {
  console.log("\n=== style_overrides ===");
  const { data: oldStyles, error } = await old
    .from("style_overrides")
    .select("style_guide, favorite_emails, hard_rules, accounts(email_address)");
  if (error) throw new Error(`old style_overrides: ${error.message}`);
  const list = (oldStyles || []) as Array<{
    style_guide: string;
    favorite_emails: string;
    hard_rules: string;
    accounts: { email_address: string } | { email_address: string }[] | null;
  }>;
  console.log(`Found ${list.length} style_overrides in inbox-agent.`);

  const rows: Record<string, unknown>[] = [];
  const skipped: string[] = [];
  for (const s of list) {
    const acc = Array.isArray(s.accounts) ? s.accounts[0] : s.accounts;
    const email = acc?.email_address?.toLowerCase();
    if (!email) {
      skipped.push("(no account email)");
      continue;
    }
    const newAccId = accMap.get(email);
    if (!newAccId) {
      skipped.push(`${email} not connected`);
      continue;
    }
    rows.push({
      user_id: userId,
      account_id: newAccId,
      style_guide: s.style_guide ?? "",
      favorite_emails: s.favorite_emails ?? "",
      hard_rules: s.hard_rules ?? "",
      updated_at: new Date().toISOString(),
    });
  }

  if (skipped.length) {
    console.log(`Skipped ${skipped.length}:`);
    for (const s of skipped) console.log(`  - ${s}`);
  }
  if (rows.length === 0) {
    console.log("Nothing to import.");
    return;
  }

  console.log(`Upserting ${rows.length} style_overrides…`);
  // PRIMARY KEY is account_id, so on conflict the row is replaced.
  const { data, error: insertErr } = await next
    .from("email_style_overrides")
    .upsert(rows, { onConflict: "account_id" })
    .select();
  if (insertErr) throw new Error(`upsert style_overrides: ${insertErr.message}`);
  console.log(`✅ style_overrides imported: ${data?.length ?? 0}`);
}

// --- Entry -----------------------------------------------------------------

async function main() {
  console.log("🚚 Migrating inbox-agent → naldo-brain");
  console.log(`   user_id = ${userId}`);
  const accMap = await loadAccountMap();

  // What to migrate. Comment / uncomment as needed.
  await migrateLabels(accMap);
  await migrateSenderRules(accMap);
  await migrateStyleOverrides(accMap);

  console.log("\n🎉 Done.");
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n❌ ${msg}`);
  process.exit(1);
});
