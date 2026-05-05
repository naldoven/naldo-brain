# PR description (paste this into the GitHub PR form)

Title: `Inbox Agent: port standalone service into Naldo's Brain`

Branch: `feat/inbox-merge` → `main`

Open PR at: <https://github.com/naldoven/naldo-brain/pull/new/feat/inbox-merge>

---

## Summary

Ports the standalone `inbox-agent` service into Naldo's Brain as a built-in tool. Adds a `/inbox` dashboard for triaging Gmail across multiple connected accounts, plus the cron + OAuth wiring needed to run it.

After merge: follow `docs/inbox-cutover.md` to migrate from the old `inbox-agent.onrender.com` service. Old service stays running side-by-side for a week before decommission.

## What's in here

**Phase 1 — Schema + lib (commit `06053bd`)**
- `supabase/migrations/0001_inbox.sql` — 9 `email_*` tables, all `user_id`-scoped with `self_access` RLS policies tied to `auth.uid()`.
- `lib/inbox/*` — types, AES-256-GCM encryption, Anthropic classifier (Haiku 4.5), Gmail wrapper (`@googleapis/gmail`), triage runner with throttling + 24h deferred sweep + corrections-as-few-shot training, RFC 8058 unsubscribe.

**Phase 2 — API routes (commit `fe910c5`)**
- OAuth: `/api/auth/google/gmail/{start,callback}` with id_token / userinfo email lookup.
- Cron: `/api/cron/email-triage` (10 min) + `/api/cron/email-daily-summary` (7am ET). Both auth via `CRON_SECRET`, service-role Supabase, iterate every active user.
- Drafts: 8 routes under `/api/inbox/drafts/[id]/` — approve / reject / dismiss / edit / trash / confirm / label / unsubscribe-trash.
- Audit: `/api/inbox/audit/[id]/` — unarchive / mark-wrong.
- CRUD: `/api/inbox/{labels,sender-rules}` (collection) + `[id]` (single) + `/api/inbox/settings/style`.

**Phase 3 — Dashboard UI (commit `9893aee`)**
- `/inbox` — pending email cards with all actions (Approve & open, Edit, Reject, Confirm AI, Always archive @domain, Trash, Unsubscribe + block) + per-card label dropdown.
- `/inbox/audit` — last 30 days of archives, search, un-archive + mark-wrong buttons.
- `/inbox/settings` — connect Gmail, voice profile / style guide / hard rules form, labels manager with all 7 default_action options.
- Sidebar: new "Inbox" entry under Daily Use group.
- Matches naldo-brain's glass design (`glass`, `glass-strong`, `brand-gradient`, lucide icons, sonner toasts).

**Phase 4 — Cutover doc (commit `ffbd744`)**
- `docs/inbox-cutover.md` — step-by-step runbook for production cutover, including rollback notes.

## Test plan

- [x] `npx tsc --noEmit` passes (verified locally — exit 0)
- [x] `npx eslint` clean on changed files (1 pre-existing unused-arg warning, 0 errors)
- [ ] After merge, follow `docs/inbox-cutover.md`:
  - [ ] Apply migration to Naldo's Brain Supabase
  - [ ] Add `TOKEN_ENCRYPTION_KEY` + `CRON_SECRET` env vars on Render
  - [ ] Add Gmail OAuth redirect URI `https://naldo-brain.onrender.com/api/auth/google/gmail/callback` in Google Cloud
  - [ ] Re-authorize 3 Gmail accounts via `/inbox/settings`
  - [ ] Register both cron jobs on Render
  - [ ] Smoke test: trigger triage cron manually, verify `/inbox` populates
  - [ ] Smoke test: approve / reject / archive / un-archive flows
  - [ ] Smoke test: force-run daily summary, verify digest email arrives

## Notes

- Multi-user ready: `user_id` FK + RLS on every email table. The cron job iterates all active accounts across all users.
- Service-role Supabase client is used only inside the cron handlers (where we need to bypass RLS to process every user). Dashboard CRUD uses the user-scoped client and depends on RLS.
- Prompt caching is currently disabled (TODO in `lib/inbox/anthropic.ts`) because Naldo's Brain pins `@anthropic-ai/sdk@0.32.1` which doesn't expose `cache_control` types. Re-enable when SDK is bumped to ≥0.40.
