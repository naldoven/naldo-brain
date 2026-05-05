# Inbox Agent Cutover Runbook

This runbook walks through merging the Inbox Agent (formerly its own Render service at `inbox-agent-0mz0.onrender.com`) into Naldo's Brain and decommissioning the old service. Follow the steps in order — each step is verifiable before moving on.

The plan: Naldo's Brain becomes the single home for all email triage. The old `inbox-agent` repo and Render service get archived after one week of overlap.

## Prereqs

- This branch (`feat/inbox-merge`) merged or about to merge into `main`.
- Owner access to: GitHub `naldoven/naldo-brain`, Render workspace running `naldo-brain.onrender.com`, the Naldo's Brain Supabase project, the Google Cloud OAuth client used by `inbox-agent`.
- The old `inbox-agent` Render service still running so we can compare behavior side-by-side during the overlap.

## Step 1 — Apply the migration to Naldo's Brain Supabase

The `0001_inbox.sql` migration creates 9 new tables (`email_accounts`, `email_messages`, `email_voice_profiles`, `email_style_overrides`, `email_labels`, `email_sender_rules`, `email_archive_audit`, `email_corrections`, `email_settings`) with RLS enabled and `self_access` policies tied to `auth.uid()`.

1. Open the Supabase SQL editor for the Naldo's Brain project.
2. Paste the contents of `supabase/migrations/0001_inbox.sql`. Run.
3. Verify in Database → Tables that the 9 `email_*` tables exist. Click any one → Policies → confirm `self_access` is listed.

If anything fails, drop the partial tables before retrying — the migration is not idempotent in the failure direction.

## Step 2 — Add env vars on Render (naldo-brain service)

Add these to the Naldo's Brain Render web service environment:

| Var | Value | Notes |
|---|---|---|
| `TOKEN_ENCRYPTION_KEY` | 32-byte hex string | Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Same value as `inbox-agent`** so we can later re-import its encrypted refresh tokens directly. Grab it from the old service's env. |
| `CRON_SECRET` | random hex | If naldo-brain doesn't already have one, generate fresh. Save the value — we use it on the cron jobs in step 5. |
| `ANTHROPIC_MODEL_INBOX` | `claude-haiku-4-5` | Optional. Defaults to haiku-4.5 if unset. |
| `INBOX_MAX_MESSAGES_PER_TICK` | `20` | Optional. Throttling. |
| `INBOX_MS_BETWEEN_MESSAGES` | `300` | Optional. Throttling. |

`NEXT_PUBLIC_APP_URL`, `ANTHROPIC_API_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` should already be present.

Trigger a deploy after adding the vars.

## Step 3 — Add the Gmail OAuth redirect URI to Google Cloud

The inbox-agent flow uses `GOOGLE_OAUTH_CLIENT_ID`/`SECRET` (already wired for Calendar). We need to authorize the new callback URL.

1. Open Google Cloud Console → APIs & Services → Credentials.
2. Edit the OAuth 2.0 Client ID currently used by Naldo's Brain.
3. Under **Authorized redirect URIs**, add:
   ```
   https://naldo-brain.onrender.com/api/auth/google/gmail/callback
   ```
4. Under the OAuth consent screen → **Scopes**, add **`https://www.googleapis.com/auth/gmail.modify`** if not already present. The other scopes (`openid`, `email`, calendar.events) stay.
5. Save.

## Step 4 — Re-authorize the three Gmail accounts

Because the new service issues tokens against its own callback URL and stores them in a different table, accounts must re-authorize. (We can later import the `inbox-agent` refresh tokens directly — see step 7. For first cutover, simplest is fresh auth.)

1. Visit `https://naldo-brain.onrender.com/inbox/settings`.
2. Click **Connect another Gmail account**.
3. At the Google account picker, sign into `sales@yulelovelights.com`. Approve the Gmail scopes.
4. You'll land back on `/inbox?connected=sales@yulelovelights.com`.
5. Repeat for `naldoven@yulelovelights.com`.
6. Repeat for your personal Gmail.

After all three: `/inbox/settings` should show three account sections.

## Step 5 — Add the two cron jobs on Render

Render → Cron Jobs → New Cron Job. Two jobs against the naldo-brain service:

**Job 1: email-triage (every 10 min)**
- Schedule: `*/10 * * * *`
- Command: `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://naldo-brain.onrender.com/api/cron/email-triage`

**Job 2: email-daily-summary (7am ET = 11am UTC weekdays / 12pm UTC weekends; pick one)**
- Schedule: `0 11 * * *` (11am UTC = 7am EDT, fine year-round if you accept ±1h DST drift)
- Command: `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://naldo-brain.onrender.com/api/cron/email-daily-summary`

Render's UI lets you pin `$CRON_SECRET` from the service env — use that, don't paste the literal value.

## Step 6 — Smoke test before turning off the old service

While both services are still running:

1. Manually hit the cron endpoint:
   ```bash
   curl -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" \
     https://naldo-brain.onrender.com/api/cron/email-triage
   ```
   Should return JSON with `ok: true` and `totals` object.

2. Visit `/inbox` — should show pending items if any new mail came in.

3. Approve / reject / archive a message — verify Gmail behavior matches.

4. Visit `/inbox/audit` — verify recent archives appear, click un-archive on one to confirm Gmail un-archive works.

5. Force-run the daily summary:
   ```bash
   curl -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" \
     https://naldo-brain.onrender.com/api/cron/email-daily-summary
   ```
   Verify the digest email lands.

If everything works for 24-48 hours, move on.

## Step 7 — Migrate historical data (optional but recommended)

To carry over the audit trail and corrections-as-training data from `inbox-agent`'s Supabase:

1. From inbox-agent's Supabase SQL editor, export with this query, replacing `YOUR_USER_ID` with the auth.users.id of the same user in naldo-brain (look it up first):
   ```sql
   SELECT
     m.gmail_message_id, m.gmail_thread_id, m.from_address, m.from_name,
     m.to_addresses, m.subject, m.snippet, m.received_at, m.bucket,
     m.confidence, m.reason, m.reply_needed, m.draft_subject, m.draft_body,
     m.action_taken, m.blocked_by_rule, m.gmail_draft_id, m.status,
     m.claude_input_hash, m.label_id, m.processed_at, m.user_action_at,
     a.email_address as account_email
   FROM messages m JOIN accounts a ON m.account_id = a.id;
   ```
2. Use the result + a small script to bulk-insert into `email_messages` mapping `account_email` → `email_accounts.id` in naldo-brain. (I can write that script when ready — it's a one-off `migrate-historical.ts`.)

For first cutover this is OK to skip — the worst case is a 1-week gap in the audit log, which is fine.

## Step 8 — Decommission the old service

After 1 week of side-by-side running with no issues:

1. Render → inbox-agent service → Settings → Suspend (or Delete).
2. GitHub → naldoven/inbox-agent → Settings → Archive repository.
3. Optional: revoke the old service's OAuth tokens. Visit https://myaccount.google.com/permissions for each Gmail account, find the old "Inbox Agent" entry, click "Remove Access".

## Rollback

If something goes wrong before step 8:

- The old `inbox-agent` service is still running and processing mail — flip its env var `PAUSED=1` to true if both services are double-processing (double drafts). Or just suspend the new naldo-brain cron jobs.
- The schema migration is additive. To undo: drop the `email_*` tables in the naldo-brain Supabase. The rest of Naldo's Brain is unaffected.
- The OAuth redirect URI addition is harmless to leave even on rollback.

## Verification checklist

- [ ] Migration applied; 9 `email_*` tables visible with RLS policies
- [ ] `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET` set on Naldo's Brain Render
- [ ] OAuth redirect URI for `/api/auth/google/gmail/callback` added in Google Cloud
- [ ] `gmail.modify` scope present in OAuth consent screen
- [ ] All 3 Gmail accounts re-authorized via `/inbox/settings`
- [ ] Both cron jobs registered on Render (every 10 min + daily 7am ET)
- [ ] Manual smoke test: triage cron returns `ok: true`
- [ ] Manual smoke test: a real new email gets surfaced or archived correctly
- [ ] Manual smoke test: un-archive on `/inbox/audit` actually puts the message back
- [ ] Manual smoke test: daily summary email arrives
- [ ] After 1 week: old `inbox-agent` Render service suspended/deleted
- [ ] After 1 week: old `inbox-agent` GitHub repo archived
