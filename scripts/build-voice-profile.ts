/**
 * One-shot (re-runnable) script to generate per-account voice profiles.
 *
 * For each connected email_accounts row:
 *   1. Pull the most recent ~50 sent emails via Gmail API
 *   2. Ask Claude to write a voice profile from them
 *   3. Upsert the profile into email_voice_profiles
 *
 * Re-run anytime your voice changes substantially or drafts feel off.
 *
 * Setup
 * -----
 * Required env vars (set inline in PowerShell):
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://<naldo-brain>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=<naldo-brain service role key>
 *   ANTHROPIC_API_KEY=<your Anthropic API key>
 *
 * Optional:
 *   ANTHROPIC_MODEL_INBOX=claude-haiku-4-5   (defaults to haiku-4-5)
 *   GOOGLE_OAUTH_CLIENT_ID=<...>            (needed by getGmailForAccount)
 *   GOOGLE_OAUTH_CLIENT_SECRET=<...>
 *   TOKEN_ENCRYPTION_KEY=<...>               (must match what's used in production)
 *
 * Run
 * ---
 *   $env:NEXT_PUBLIC_SUPABASE_URL = "..."
 *   $env:SUPABASE_SERVICE_ROLE_KEY = "..."
 *   $env:ANTHROPIC_API_KEY = "..."
 *   $env:GOOGLE_OAUTH_CLIENT_ID = "..."
 *   $env:GOOGLE_OAUTH_CLIENT_SECRET = "..."
 *   $env:TOKEN_ENCRYPTION_KEY = "..."
 *   npx tsx scripts/build-voice-profile.ts
 *
 * (Easiest: copy these from naldo-brain's Render service environment.)
 */

import { createClient } from "@supabase/supabase-js";
import { getGmailForAccount, listSentEmails } from "../lib/inbox/gmail";
import { buildVoiceProfile } from "../lib/inbox/anthropic";
import type { EmailAccountRow } from "../lib/inbox/types";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`❌ Missing env var: ${name}`);
    console.error(`   See script header for setup instructions.`);
    process.exit(1);
  }
  return v;
}

const SUPABASE_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
requireEnv("ANTHROPIC_API_KEY");
requireEnv("GOOGLE_OAUTH_CLIENT_ID");
requireEnv("GOOGLE_OAUTH_CLIENT_SECRET");
requireEnv("TOKEN_ENCRYPTION_KEY");

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  console.log("🎤 Building voice profiles");

  const { data: accounts, error } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("is_active", true);
  if (error) throw new Error(`Failed to load email_accounts: ${error.message}`);
  if (!accounts || accounts.length === 0) {
    console.log("No active accounts. Connect Gmail accounts via /inbox/settings first.");
    return;
  }
  console.log(`Found ${accounts.length} active account(s).`);

  const list = accounts as EmailAccountRow[];
  for (let i = 0; i < list.length; i++) {
    const account = list[i];

    // Pause between accounts to dodge Anthropic's per-minute input-token cap.
    if (i > 0) {
      const waitSec = 65;
      console.log(`\n(waiting ${waitSec}s for rate-limit window to reset…)`);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
    }

    console.log(`\n━━━ ${account.email_address} ━━━`);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gmail = await getGmailForAccount(supabase as any, account);

      console.log("Pulling last 50 sent emails…");
      const sent = await listSentEmails(gmail, 50);
      console.log(`✓ Got ${sent.length} sent emails`);

      if (sent.length < 5) {
        console.log("⚠ Fewer than 5 sent emails — voice profile would be weak. Skipping.");
        continue;
      }

      console.log("Asking Claude to build voice profile…");
      const profile = await buildVoiceProfile({
        accountEmail: account.email_address,
        sentEmails: sent,
      });

      const { error: upsertErr } = await supabase
        .from("email_voice_profiles")
        .upsert(
          {
            account_id: account.id,
            user_id: account.user_id,
            profile_text: profile,
            source_email_count: sent.length,
            generated_at: new Date().toISOString(),
          },
          { onConflict: "account_id" },
        );
      if (upsertErr) {
        console.error(`✗ Upsert failed: ${upsertErr.message}`);
        continue;
      }

      console.log("✓ Voice profile stored.");
      console.log("--- preview (first 400 chars) ---");
      console.log(profile.slice(0, 400) + (profile.length > 400 ? "..." : ""));
    } catch (err) {
      console.error(
        `✗ Failed for ${account.email_address}: ${(err as Error).message}`,
      );
    }
  }

  console.log("\n🎉 All done. Profiles can be edited later under /inbox/settings.");
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? (err.stack || err.message) : String(err);
  console.error(`\n❌ ${msg}`);
  process.exit(1);
});
