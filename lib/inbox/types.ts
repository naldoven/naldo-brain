/**
 * Shared types for the Inbox module.
 *
 * Schema source-of-truth: supabase/migrations/0001_inbox.sql
 * Keep these in sync with that file when columns change.
 */

// ----------------------------------------------------------------------------
// Database row types
// ----------------------------------------------------------------------------

export interface EmailAccountRow {
  id: string;
  user_id: string;
  email_address: string;
  refresh_token_encrypted: string;
  access_token: string | null;
  access_token_expires_at: string | null;
  last_polled_at: string;
  display_label: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EmailVoiceProfileRow {
  account_id: string;
  user_id: string;
  profile_text: string;
  source_email_count: number;
  generated_at: string;
}

export interface EmailStyleOverridesRow {
  account_id: string;
  user_id: string;
  style_guide: string;
  favorite_emails: string;
  hard_rules: string;
  updated_at: string;
}

export type Bucket = "NEEDS_ATTENTION" | "ARCHIVE";

export type ActionTaken =
  | "archived"
  | "drafted"
  | "queued_no_draft"
  | "blocked_by_rule";

export type MessageStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "dismissed"
  | "archived"
  | "unarchived";

export interface EmailMessageRow {
  id: string;
  user_id: string;
  account_id: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  from_address: string;
  from_name: string | null;
  to_addresses: string[];
  subject: string | null;
  snippet: string | null;
  received_at: string;
  bucket: Bucket;
  confidence: number;
  reason: string;
  reply_needed: boolean;
  draft_subject: string | null;
  draft_body: string | null;
  action_taken: ActionTaken;
  blocked_by_rule: string | null;
  gmail_draft_id: string | null;
  status: MessageStatus;
  claude_input_hash: string | null;
  label_id: string | null;
  processed_at: string;
  user_action_at: string | null;
}

export interface EmailArchiveAuditRow {
  message_id: string;
  user_id: string;
  archived_at: string;
  unarchived_at: string | null;
  marked_wrong_at: string | null;
  user_note: string | null;
}

export interface EmailSettingsRow {
  user_id: string;
  confidence_threshold: number;
  daily_summary_enabled: boolean;
  daily_summary_from: string | null;
  daily_summary_to: string | null;
  realtime_alerts_enabled: boolean;
  realtime_alerts_until: string | null;
  updated_at: string;
}

export type DefaultAction =
  | "archive_only"
  | "keep_in_inbox"
  | "surface_no_draft"
  | "surface_with_draft"
  | "trash_only"
  | "archive_after_24h"
  | "trash_after_24h";

export interface EmailLabelRow {
  id: string;
  user_id: string;
  account_id: string;
  name: string;
  description: string;
  gmail_label_id: string | null;
  default_action: DefaultAction;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type SenderRulePatternType = "exact_email" | "domain";
export type SenderRuleAction = "archive" | "surface" | "apply_label" | "trash";

export interface EmailSenderRuleRow {
  id: string;
  user_id: string;
  account_id: string;
  sender_pattern: string;
  pattern_type: SenderRulePatternType;
  action: SenderRuleAction;
  apply_label_id: string | null;
  reason: string | null;
  created_at: string;
}

export interface EmailCorrectionRow {
  id: string;
  user_id: string;
  account_id: string;
  message_id: string | null;
  from_address: string;
  from_name: string | null;
  subject: string | null;
  snippet: string | null;
  original_label_id: string | null;
  original_label_name: string | null;
  corrected_label_id: string | null;
  corrected_label_name: string | null;
  created_at: string;
}

// ----------------------------------------------------------------------------
// Domain types (used between modules)
// ----------------------------------------------------------------------------

export interface FetchedEmail {
  gmailMessageId: string;
  gmailThreadId: string;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  subject: string | null;
  snippet: string;
  bodyText: string;
  receivedAt: string;
  headers: Record<string, string>;
}

export interface Classification {
  bucket: Bucket;
  confidence: number;
  reason: string;
  reply_needed: boolean;
  draft_subject: string;
  draft_body: string;
}

export interface LabelClassification {
  label_id: string | null;
  confidence: number;
  reason: string;
  draft_subject: string;
  draft_body: string;
}

export interface SafetyRailResult {
  blocked: boolean;
  ruleName: string | null;
}
