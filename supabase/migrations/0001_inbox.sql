-- =============================================================================
-- Naldo Brain — Inbox module migration (ports inbox-agent into naldo-brain)
-- =============================================================================
-- Adds the email triage feature as a new module alongside calendar/tasks/etc.
-- All tables are prefixed `email_*` to avoid conflicts with existing schema
-- (profiles, tasks, captures, calendar_events, etc.).
--
-- Multi-user-ready: every row scoped by user_id (FK to auth.users), with RLS
-- so each user only sees their own data. Service role (used by cron jobs and
-- webhook handlers) bypasses RLS as expected.
--
-- Run in Supabase SQL Editor for the naldo-brain project. Idempotent — safe
-- to re-run (uses CREATE TABLE IF NOT EXISTS, etc.).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- email_accounts: connected Gmail inboxes per user
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_accounts (
  id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_address               TEXT         NOT NULL,
  refresh_token_encrypted     TEXT         NOT NULL,
  access_token                TEXT,
  access_token_expires_at     TIMESTAMPTZ,
  last_polled_at              TIMESTAMPTZ  DEFAULT now(),
  display_label               TEXT,
  is_active                   BOOLEAN      NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (user_id, email_address)
);

CREATE INDEX IF NOT EXISTS email_accounts_user_idx ON email_accounts (user_id);

-- -----------------------------------------------------------------------------
-- email_voice_profiles: per-account voice profile generated from sent folder
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_voice_profiles (
  account_id                  UUID         PRIMARY KEY REFERENCES email_accounts(id) ON DELETE CASCADE,
  user_id                     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_text                TEXT         NOT NULL,
  source_email_count          INTEGER      NOT NULL DEFAULT 0,
  generated_at                TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_voice_profiles_user_idx ON email_voice_profiles (user_id);

-- -----------------------------------------------------------------------------
-- email_style_overrides: per-account user-curated style guide + favorites
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_style_overrides (
  account_id                  UUID         PRIMARY KEY REFERENCES email_accounts(id) ON DELETE CASCADE,
  user_id                     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  style_guide                 TEXT         NOT NULL DEFAULT '',
  favorite_emails             TEXT         NOT NULL DEFAULT '',
  hard_rules                  TEXT         NOT NULL DEFAULT '',
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_style_overrides_user_idx ON email_style_overrides (user_id);

-- -----------------------------------------------------------------------------
-- email_labels: per-account user-defined categorization labels
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_labels (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id          UUID         NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  name                TEXT         NOT NULL,
  description         TEXT         NOT NULL DEFAULT '',
  gmail_label_id      TEXT,
  default_action      TEXT         NOT NULL CHECK (default_action IN (
    'archive_only',
    'keep_in_inbox',
    'surface_no_draft',
    'surface_with_draft',
    'trash_only',
    'archive_after_24h',
    'trash_after_24h'
  )),
  sort_order          INTEGER      NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS email_labels_account_idx ON email_labels (account_id, sort_order);
CREATE INDEX IF NOT EXISTS email_labels_user_idx ON email_labels (user_id);

-- -----------------------------------------------------------------------------
-- email_sender_rules: per-account sender-level overrides (always archive/trash)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_sender_rules (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id          UUID         NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  sender_pattern      TEXT         NOT NULL,
  pattern_type        TEXT         NOT NULL CHECK (pattern_type IN ('exact_email', 'domain')),
  action              TEXT         NOT NULL CHECK (action IN ('archive', 'surface', 'apply_label', 'trash')),
  apply_label_id      UUID         REFERENCES email_labels(id) ON DELETE SET NULL,
  reason              TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (account_id, sender_pattern, pattern_type)
);

CREATE INDEX IF NOT EXISTS email_sender_rules_account_pattern_idx ON email_sender_rules (account_id, sender_pattern);

-- -----------------------------------------------------------------------------
-- email_messages: every email the agent has touched
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_messages (
  id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id                  UUID         NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  gmail_message_id            TEXT         NOT NULL,
  gmail_thread_id             TEXT         NOT NULL,

  -- Raw email metadata (denormalized for fast dashboard reads)
  from_address                TEXT         NOT NULL,
  from_name                   TEXT,
  to_addresses                TEXT[]       NOT NULL DEFAULT '{}',
  subject                     TEXT,
  snippet                     TEXT,
  received_at                 TIMESTAMPTZ  NOT NULL,

  -- Claude's classification output
  bucket                      TEXT         NOT NULL CHECK (bucket IN ('NEEDS_ATTENTION', 'ARCHIVE')),
  confidence                  REAL         NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  reason                      TEXT         NOT NULL,
  reply_needed                BOOLEAN      NOT NULL DEFAULT false,
  draft_subject               TEXT,
  draft_body                  TEXT,

  -- What actually happened (after applying safety rails)
  action_taken                TEXT         NOT NULL CHECK (action_taken IN (
    'archived', 'drafted', 'queued_no_draft', 'blocked_by_rule'
  )),
  blocked_by_rule             TEXT,
  gmail_draft_id              TEXT,

  -- Dashboard state
  status                      TEXT         NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'rejected', 'dismissed', 'archived', 'unarchived'
  )),

  claude_input_hash           TEXT,
  label_id                    UUID         REFERENCES email_labels(id) ON DELETE SET NULL,

  processed_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  user_action_at              TIMESTAMPTZ,

  UNIQUE (account_id, gmail_message_id)
);

CREATE INDEX IF NOT EXISTS email_messages_user_status_idx ON email_messages (user_id, status, received_at DESC);
CREATE INDEX IF NOT EXISTS email_messages_dashboard_idx ON email_messages (status, received_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS email_messages_audit_idx ON email_messages (action_taken, processed_at DESC) WHERE action_taken = 'archived';
CREATE INDEX IF NOT EXISTS email_messages_thread_idx ON email_messages (gmail_thread_id);
CREATE INDEX IF NOT EXISTS email_messages_label_idx ON email_messages (label_id, processed_at DESC) WHERE label_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- email_archive_audit: explicit table for archive recovery flow
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_archive_audit (
  message_id                  UUID         PRIMARY KEY REFERENCES email_messages(id) ON DELETE CASCADE,
  user_id                     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  archived_at                 TIMESTAMPTZ  NOT NULL DEFAULT now(),
  unarchived_at               TIMESTAMPTZ,
  marked_wrong_at             TIMESTAMPTZ,
  user_note                   TEXT
);

CREATE INDEX IF NOT EXISTS email_archive_audit_user_recent_idx ON email_archive_audit (user_id, archived_at DESC);
CREATE INDEX IF NOT EXISTS email_archive_audit_wrong_idx ON email_archive_audit (marked_wrong_at) WHERE marked_wrong_at IS NOT NULL;

-- -----------------------------------------------------------------------------
-- email_corrections: training signal from manual relabels
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_corrections (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id              UUID         NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  message_id              UUID         REFERENCES email_messages(id) ON DELETE SET NULL,
  from_address            TEXT         NOT NULL,
  from_name               TEXT,
  subject                 TEXT,
  snippet                 TEXT,
  original_label_id       UUID         REFERENCES email_labels(id) ON DELETE SET NULL,
  original_label_name     TEXT,
  corrected_label_id      UUID         REFERENCES email_labels(id) ON DELETE SET NULL,
  corrected_label_name    TEXT,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_corrections_account_recent_idx ON email_corrections (account_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- email_settings: per-user inbox-feature settings (one row per user)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_settings (
  user_id                     UUID         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  confidence_threshold        REAL         NOT NULL DEFAULT 0.85 CHECK (confidence_threshold BETWEEN 0 AND 1),
  daily_summary_enabled       BOOLEAN      NOT NULL DEFAULT true,
  daily_summary_from          TEXT,
  daily_summary_to            TEXT,
  realtime_alerts_enabled     BOOLEAN      NOT NULL DEFAULT true,
  realtime_alerts_until       TIMESTAMPTZ,
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- updated_at triggers (re-uses set_updated_at() if it already exists)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at_email() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS email_accounts_updated_at ON email_accounts;
CREATE TRIGGER email_accounts_updated_at BEFORE UPDATE ON email_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_email();

DROP TRIGGER IF EXISTS email_style_overrides_updated_at ON email_style_overrides;
CREATE TRIGGER email_style_overrides_updated_at BEFORE UPDATE ON email_style_overrides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_email();

DROP TRIGGER IF EXISTS email_labels_updated_at ON email_labels;
CREATE TRIGGER email_labels_updated_at BEFORE UPDATE ON email_labels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_email();

DROP TRIGGER IF EXISTS email_settings_updated_at ON email_settings;
CREATE TRIGGER email_settings_updated_at BEFORE UPDATE ON email_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_email();

-- -----------------------------------------------------------------------------
-- Row-Level Security: each user sees only their own rows.
-- Service role (used by cron jobs and webhook handlers) bypasses RLS.
-- -----------------------------------------------------------------------------
ALTER TABLE email_accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_voice_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_style_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_labels          ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_sender_rules    ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_archive_audit   ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_corrections     ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_settings        ENABLE ROW LEVEL SECURITY;

-- Generic policy template: authenticated users CRUD their own rows.
-- (Drop+create instead of CREATE OR REPLACE since Postgres doesn't support that for policies.)
DROP POLICY IF EXISTS "self_access" ON email_accounts;
CREATE POLICY "self_access" ON email_accounts
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "self_access" ON email_voice_profiles;
CREATE POLICY "self_access" ON email_voice_profiles
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "self_access" ON email_style_overrides;
CREATE POLICY "self_access" ON email_style_overrides
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "self_access" ON email_labels;
CREATE POLICY "self_access" ON email_labels
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "self_access" ON email_sender_rules;
CREATE POLICY "self_access" ON email_sender_rules
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "self_access" ON email_messages;
CREATE POLICY "self_access" ON email_messages
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "self_access" ON email_archive_audit;
CREATE POLICY "self_access" ON email_archive_audit
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "self_access" ON email_corrections;
CREATE POLICY "self_access" ON email_corrections
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "self_access" ON email_settings;
CREATE POLICY "self_access" ON email_settings
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
