/**
 * Per-account triage loop. Called by /api/cron/email-triage.
 *
 * For each active email_account:
 *  1. Run the deferred-action sweep (handles archive_after_24h / trash_after_24h)
 *  2. Fetch new INBOX messages since email_accounts.last_polled_at
 *  3. For each message:
 *      a. Idempotency check
 *      b. Sender-rule shortcut (if a rule matches, apply directly, skip Claude)
 *      c. Else: classify via Claude (label-based if account has labels, else
 *         legacy bucket-based)
 *      d. Apply Gmail action + insert email_messages row
 *  4. Throttled: cap N per tick, sleep between calls, stop early on 429
 *  5. Update last_polled_at only if at least one message succeeded
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyGmailLabel,
  archiveMessage,
  createDraftReply,
  deleteDraft,
  getGmailForAccount,
  getMessageDetails,
  listNewInboxMessages,
  trashMessage,
} from "../gmail";
import type {
  ActionTaken,
  Bucket,
  EmailAccountRow,
  EmailCorrectionRow,
  EmailLabelRow,
  EmailMessageRow,
  EmailSenderRuleRow,
  EmailStyleOverridesRow,
  EmailVoiceProfileRow,
  FetchedEmail,
  MessageStatus,
} from "../types";
import { classify, classifyToLabel } from "./classify";
import { checkSafetyRails, isRelationshipDomain } from "./rules";

export interface TriageStats {
  accountEmail: string;
  fetched: number;
  alreadySeen: number;
  archived: number;
  drafted: number;
  queuedNoDraft: number;
  blockedByRule: number;
  errors: number;
  rateLimited: boolean;
}

// Throttling — keeps us well under Google's 250 quota-units/sec per-user limit.
const MAX_MESSAGES_PER_TICK_PER_ACCOUNT = Number(
  process.env.INBOX_MAX_MESSAGES_PER_TICK || "20",
);
const MS_BETWEEN_MESSAGES = Number(process.env.INBOX_MS_BETWEEN_MESSAGES || "300");
const MAX_DEFERRED_PER_TICK = Number(
  process.env.INBOX_MAX_DEFERRED_PER_TICK || "20",
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err: unknown): boolean {
  const msg = String((err as Error)?.message || err).toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("user-rate limit") ||
    msg.includes("quota exceeded") ||
    msg.includes("429") ||
    msg.includes("ratelimitexceeded")
  );
}

// ----------------------------------------------------------------------------
// Top-level entrypoint: process all active accounts (called by cron)
// ----------------------------------------------------------------------------

export async function runTriageForAllAccounts(
  supabase: SupabaseClient,
): Promise<TriageStats[]> {
  const { data: accounts, error } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("is_active", true);
  if (error) throw error;
  if (!accounts) return [];

  const stats: TriageStats[] = [];
  for (const account of accounts as EmailAccountRow[]) {
    try {
      const s = await runTriageForAccount(supabase, account);
      stats.push(s);
    } catch (err) {
      console.error(
        `[triage] Account ${account.email_address} failed:`,
        (err as Error).message,
      );
      stats.push({
        accountEmail: account.email_address,
        fetched: 0,
        alreadySeen: 0,
        archived: 0,
        drafted: 0,
        queuedNoDraft: 0,
        blockedByRule: 0,
        errors: 1,
        rateLimited: false,
      });
    }
  }
  return stats;
}

// ----------------------------------------------------------------------------
// Per-account
// ----------------------------------------------------------------------------

export async function runTriageForAccount(
  supabase: SupabaseClient,
  account: EmailAccountRow,
): Promise<TriageStats> {
  const stats: TriageStats = {
    accountEmail: account.email_address,
    fetched: 0,
    alreadySeen: 0,
    archived: 0,
    drafted: 0,
    queuedNoDraft: 0,
    blockedByRule: 0,
    errors: 0,
    rateLimited: false,
  };

  // Load per-account context (voice, style, labels, rules, corrections, settings)
  const [voiceRes, styleRes, settingsRes, labelsRes, rulesRes, correctionsRes] =
    await Promise.all([
      supabase
        .from("email_voice_profiles")
        .select("*")
        .eq("account_id", account.id)
        .maybeSingle(),
      supabase
        .from("email_style_overrides")
        .select("*")
        .eq("account_id", account.id)
        .maybeSingle(),
      supabase
        .from("email_settings")
        .select("*")
        .eq("user_id", account.user_id)
        .maybeSingle(),
      supabase
        .from("email_labels")
        .select("*")
        .eq("account_id", account.id)
        .order("sort_order"),
      supabase
        .from("email_sender_rules")
        .select("*")
        .eq("account_id", account.id),
      supabase
        .from("email_corrections")
        .select("*")
        .eq("account_id", account.id)
        .not("corrected_label_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(15),
    ]);

  const voiceProfile = (voiceRes.data || null) as EmailVoiceProfileRow | null;
  const styleOverrides = (styleRes.data || null) as EmailStyleOverridesRow | null;
  const labels = (labelsRes.data || []) as EmailLabelRow[];
  const labelsById = new Map<string, EmailLabelRow>(labels.map((l) => [l.id, l]));
  const senderRules = (rulesRes.data || []) as EmailSenderRuleRow[];
  const corrections = (correctionsRes.data || []) as EmailCorrectionRow[];
  const confidenceThreshold =
    settingsRes.data?.confidence_threshold ??
    Number(process.env.INBOX_CONFIDENCE_THRESHOLD || "0.85");

  // Build relationship-domain set: domains user has APPROVED drafts to
  // in the last 90 days. Tighter than original inbox-agent design.
  const ninetyDaysAgo = new Date(
    Date.now() - 90 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const recentDomains = await loadRecentRelationshipDomains(
    supabase,
    account.id,
    ninetyDaysAgo,
  );

  const gmail = await getGmailForAccount(supabase, account);

  // Deferred-action sweep (must run before fetching new mail so we don't
  // double-process anything that's about to be cleaned up)
  await runDeferredActions(supabase, gmail, account, labels);

  const ids = await listNewInboxMessages(gmail, account.last_polled_at);
  stats.fetched = ids.length;

  let processedThisTick = 0;
  for (const messageId of ids) {
    if (processedThisTick >= MAX_MESSAGES_PER_TICK_PER_ACCOUNT) {
      console.log(
        `[triage] ${account.email_address}: hit per-tick cap (${MAX_MESSAGES_PER_TICK_PER_ACCOUNT}), deferring rest to next cron`,
      );
      break;
    }
    try {
      const existing = await supabase
        .from("email_messages")
        .select("id")
        .eq("account_id", account.id)
        .eq("gmail_message_id", messageId)
        .maybeSingle();
      if (existing.data) {
        stats.alreadySeen++;
        continue;
      }

      const email = await getMessageDetails(gmail, messageId);

      if (
        email.fromAddress.toLowerCase() === account.email_address.toLowerCase()
      ) {
        stats.alreadySeen++;
        continue;
      }

      // Sender-rule shortcut: skip Claude entirely if a rule matches
      const ruleMatch = matchSenderRule(email, senderRules);
      if (ruleMatch) {
        await applySenderRule({
          supabase,
          rule: ruleMatch,
          email,
          gmail,
          messageId,
          account,
          labelsById,
          stats,
        });
        processedThisTick++;
        if (MS_BETWEEN_MESSAGES > 0) await sleep(MS_BETWEEN_MESSAGES);
        continue;
      }

      // Classification path: label-based if labels exist, else legacy bucket
      let bucket: Bucket;
      let confidence: number;
      let reason: string;
      let replyNeeded: boolean;
      let draftSubject = "";
      let draftBody = "";
      let labelId: string | null = null;
      let chosenLabel: EmailLabelRow | null = null;

      if (labels.length > 0) {
        const labelVerdict = await classifyToLabel({
          accountEmail: account.email_address,
          voiceProfile,
          styleOverrides,
          labels,
          corrections,
          email,
        });
        confidence = labelVerdict.confidence;
        reason = labelVerdict.reason;
        draftSubject = labelVerdict.draft_subject;
        draftBody = labelVerdict.draft_body;

        if (labelVerdict.label_id && labelsById.has(labelVerdict.label_id)) {
          labelId = labelVerdict.label_id;
          chosenLabel = labelsById.get(labelId)!;
          bucket =
            chosenLabel.default_action === "archive_only" ||
            chosenLabel.default_action === "keep_in_inbox" ||
            chosenLabel.default_action === "trash_only"
              ? "ARCHIVE"
              : "NEEDS_ATTENTION";
          replyNeeded = chosenLabel.default_action === "surface_with_draft";
        } else {
          // Uncategorized → fall back to legacy bucket classify on this one
          const fallback = await classify({
            accountEmail: account.email_address,
            voiceProfile,
            styleOverrides,
            email,
          });
          bucket = fallback.bucket;
          confidence = fallback.confidence;
          reason = fallback.reason;
          replyNeeded = fallback.reply_needed;
          draftSubject = fallback.draft_subject;
          draftBody = fallback.draft_body;
        }
      } else {
        const verdict = await classify({
          accountEmail: account.email_address,
          voiceProfile,
          styleOverrides,
          email,
        });
        bucket = verdict.bucket;
        confidence = verdict.confidence;
        reason = verdict.reason;
        replyNeeded = verdict.reply_needed;
        draftSubject = verdict.draft_subject;
        draftBody = verdict.draft_body;
      }

      const subjectRail = checkSafetyRails(email);
      const relationshipRail = isRelationshipDomain(email, recentDomains);
      const rail = subjectRail.blocked ? subjectRail : relationshipRail;

      let action: ActionTaken;
      let blockedByRule: string | null = null;
      let gmailDraftId: string | null = null;
      let status: MessageStatus = "pending";

      const wantsArchive =
        bucket === "ARCHIVE" && confidence >= confidenceThreshold;
      const isSilent =
        chosenLabel?.default_action === "keep_in_inbox" &&
        confidence >= confidenceThreshold;
      const wantsTrash =
        chosenLabel?.default_action === "trash_only" &&
        confidence >= confidenceThreshold;
      const wantsDeferred =
        (chosenLabel?.default_action === "archive_after_24h" ||
          chosenLabel?.default_action === "trash_after_24h") &&
        confidence >= confidenceThreshold;

      if (wantsArchive && rail.blocked) {
        bucket = "NEEDS_ATTENTION";
        action = "blocked_by_rule";
        blockedByRule = rail.ruleName;
        stats.blockedByRule++;
        if (chosenLabel?.gmail_label_id) {
          await applyGmailLabel(gmail, messageId, chosenLabel.gmail_label_id, false);
        }
      } else if (wantsTrash) {
        if (chosenLabel?.gmail_label_id) {
          await applyGmailLabel(gmail, messageId, chosenLabel.gmail_label_id, false);
        }
        await trashMessage(gmail, messageId);
        action = "archived";
        status = "archived";
        stats.archived++;
      } else if (wantsDeferred) {
        // Apply label, leave in INBOX, status=dismissed (off dashboard).
        // The deferred sweep handles archive/trash 24h later.
        if (chosenLabel?.gmail_label_id) {
          await applyGmailLabel(gmail, messageId, chosenLabel.gmail_label_id, false);
        }
        action = "queued_no_draft";
        status = "dismissed";
        stats.queuedNoDraft++;
      } else if (isSilent) {
        if (chosenLabel?.gmail_label_id) {
          await applyGmailLabel(gmail, messageId, chosenLabel.gmail_label_id, false);
        }
        action = "queued_no_draft";
        status = "dismissed";
        stats.queuedNoDraft++;
      } else if (wantsArchive) {
        if (chosenLabel?.gmail_label_id) {
          await applyGmailLabel(gmail, messageId, chosenLabel.gmail_label_id, true);
        } else {
          await archiveMessage(gmail, messageId);
        }
        action = "archived";
        status = "archived";
        stats.archived++;
      } else if (replyNeeded && draftBody.trim().length > 0) {
        if (chosenLabel?.gmail_label_id) {
          await applyGmailLabel(gmail, messageId, chosenLabel.gmail_label_id, false);
        }
        try {
          gmailDraftId = await createDraftReply({
            gmail,
            threadId: email.gmailThreadId,
            to: email.fromAddress,
            subject: email.subject || "(no subject)",
            bodyText: draftBody,
            inReplyToMessageId: email.headers["message-id"],
            references: email.headers["references"] || email.headers["message-id"],
          });
          action = "drafted";
          stats.drafted++;
        } catch (err) {
          console.error(
            `[triage] Failed to create draft for ${messageId}:`,
            (err as Error).message,
          );
          action = "queued_no_draft";
          stats.queuedNoDraft++;
        }
      } else {
        if (chosenLabel?.gmail_label_id) {
          await applyGmailLabel(gmail, messageId, chosenLabel.gmail_label_id, false);
        }
        action = "queued_no_draft";
        stats.queuedNoDraft++;
      }

      const promptHash = createHash("sha256")
        .update(
          JSON.stringify({ bucket, confidence, reason, labelId, blockedByRule }),
        )
        .digest("hex");

      const { data: inserted, error: insertErr } = await supabase
        .from("email_messages")
        .insert({
          user_id: account.user_id,
          account_id: account.id,
          gmail_message_id: messageId,
          gmail_thread_id: email.gmailThreadId,
          from_address: email.fromAddress,
          from_name: email.fromName,
          to_addresses: email.toAddresses,
          subject: email.subject,
          snippet: email.snippet,
          received_at: email.receivedAt,
          bucket,
          confidence,
          reason,
          reply_needed: replyNeeded,
          draft_subject: draftSubject || null,
          draft_body: draftBody || null,
          action_taken: action,
          blocked_by_rule: blockedByRule,
          gmail_draft_id: gmailDraftId,
          status,
          label_id: labelId,
          claude_input_hash: promptHash,
        })
        .select()
        .single();

      if (insertErr) {
        if (!String(insertErr.message).includes("duplicate")) throw insertErr;
        stats.alreadySeen++;
        continue;
      }

      if (action === "archived" && inserted) {
        await supabase.from("email_archive_audit").insert({
          message_id: (inserted as EmailMessageRow).id,
          user_id: account.user_id,
          archived_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      stats.errors++;
      console.error(
        `[triage] Message ${messageId} failed:`,
        (err as Error).stack || (err as Error).message,
      );
      if (isRateLimitError(err)) {
        stats.rateLimited = true;
        console.warn(
          `[triage] ${account.email_address}: Google rate limit hit, stopping early.`,
        );
        break;
      }
    }
    processedThisTick++;
    if (MS_BETWEEN_MESSAGES > 0) await sleep(MS_BETWEEN_MESSAGES);
  }

  // Only advance cursor if we actually made progress
  const hadAnySuccess =
    stats.fetched === 0 || stats.errors < stats.fetched;
  if (hadAnySuccess) {
    await supabase
      .from("email_accounts")
      .update({ last_polled_at: new Date().toISOString() })
      .eq("id", account.id);
  } else {
    console.warn(
      `[triage] All ${stats.fetched} messages errored for ${account.email_address} — leaving last_polled_at unchanged`,
    );
  }

  return stats;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function matchSenderRule(
  email: FetchedEmail,
  rules: EmailSenderRuleRow[],
): EmailSenderRuleRow | null {
  const fromLower = email.fromAddress.toLowerCase();
  const fromDomain = fromLower.split("@")[1] || "";
  for (const rule of rules) {
    const pattern = rule.sender_pattern.toLowerCase().replace(/^@/, "");
    if (rule.pattern_type === "exact_email") {
      if (fromLower === pattern) return rule;
    } else if (rule.pattern_type === "domain") {
      if (fromDomain === pattern || fromDomain.endsWith("." + pattern)) {
        return rule;
      }
    }
  }
  return null;
}

async function applySenderRule(args: {
  supabase: SupabaseClient;
  rule: EmailSenderRuleRow;
  email: FetchedEmail;
  gmail: import("@googleapis/gmail").gmail_v1.Gmail;
  messageId: string;
  account: EmailAccountRow;
  labelsById: Map<string, EmailLabelRow>;
  stats: TriageStats;
}): Promise<void> {
  const { supabase, rule, email, gmail, messageId, account, labelsById, stats } =
    args;

  let action: ActionTaken = "queued_no_draft";
  let bucket: Bucket = "NEEDS_ATTENTION";
  let status: MessageStatus = "pending";
  let labelId: string | null = null;

  if (rule.action === "archive") {
    await archiveMessage(gmail, messageId);
    action = "archived";
    bucket = "ARCHIVE";
    status = "archived";
    stats.archived++;
  } else if (rule.action === "trash") {
    await trashMessage(gmail, messageId);
    action = "archived";
    bucket = "ARCHIVE";
    status = "archived";
    stats.archived++;
  } else if (rule.action === "surface") {
    stats.queuedNoDraft++;
  } else if (rule.action === "apply_label" && rule.apply_label_id) {
    const label = labelsById.get(rule.apply_label_id);
    if (label) {
      labelId = label.id;
      const archive = label.default_action === "archive_only";
      const silent = label.default_action === "keep_in_inbox";
      if (label.gmail_label_id) {
        await applyGmailLabel(gmail, messageId, label.gmail_label_id, archive);
      } else if (archive) {
        await archiveMessage(gmail, messageId);
      }
      if (archive) {
        action = "archived";
        bucket = "ARCHIVE";
        status = "archived";
        stats.archived++;
      } else if (silent) {
        action = "queued_no_draft";
        bucket = "ARCHIVE";
        status = "dismissed";
      } else {
        action = "queued_no_draft";
        bucket = "NEEDS_ATTENTION";
        status = "pending";
        stats.queuedNoDraft++;
      }
    }
  }

  const reason = `sender_rule: ${rule.pattern_type}=${rule.sender_pattern} → ${rule.action}`;
  const promptHash = createHash("sha256").update(reason).digest("hex");

  const { data: inserted, error: insertErr } = await supabase
    .from("email_messages")
    .insert({
      user_id: account.user_id,
      account_id: account.id,
      gmail_message_id: messageId,
      gmail_thread_id: email.gmailThreadId,
      from_address: email.fromAddress,
      from_name: email.fromName,
      to_addresses: email.toAddresses,
      subject: email.subject,
      snippet: email.snippet,
      received_at: email.receivedAt,
      bucket,
      confidence: 1.0,
      reason,
      reply_needed: false,
      draft_subject: null,
      draft_body: null,
      action_taken: action,
      blocked_by_rule: null,
      gmail_draft_id: null,
      status,
      label_id: labelId,
      claude_input_hash: promptHash,
    })
    .select()
    .single();

  if (insertErr) {
    if (!String(insertErr.message).includes("duplicate")) throw insertErr;
    stats.alreadySeen++;
    return;
  }

  if (action === "archived" && inserted) {
    await supabase.from("email_archive_audit").insert({
      message_id: (inserted as EmailMessageRow).id,
      user_id: account.user_id,
      archived_at: new Date().toISOString(),
    });
  }
}

/**
 * Sweep messages that were classified into archive_after_24h / trash_after_24h
 * labels more than 24 hours ago and apply the deferred action.
 */
async function runDeferredActions(
  supabase: SupabaseClient,
  gmail: import("@googleapis/gmail").gmail_v1.Gmail,
  account: EmailAccountRow,
  labels: EmailLabelRow[],
): Promise<void> {
  const deferredLabels = labels.filter(
    (l) =>
      l.default_action === "archive_after_24h" ||
      l.default_action === "trash_after_24h",
  );
  if (deferredLabels.length === 0) return;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: due, error } = await supabase
    .from("email_messages")
    .select("*")
    .eq("account_id", account.id)
    .in("status", ["pending", "dismissed"])
    .in(
      "label_id",
      deferredLabels.map((l) => l.id),
    )
    .lt("processed_at", cutoff);
  if (error) {
    console.error("[deferred-actions] query failed:", error.message);
    return;
  }

  let deferredCount = 0;
  for (const m of (due || []) as EmailMessageRow[]) {
    if (deferredCount >= MAX_DEFERRED_PER_TICK) {
      console.log(
        `[deferred-actions] hit per-tick cap (${MAX_DEFERRED_PER_TICK}), rest waits for next cron`,
      );
      break;
    }
    const label = deferredLabels.find((l) => l.id === m.label_id);
    if (!label) continue;
    try {
      if (label.default_action === "trash_after_24h") {
        await trashMessage(gmail, m.gmail_message_id);
      } else {
        await archiveMessage(gmail, m.gmail_message_id);
      }
      if (m.gmail_draft_id) {
        try {
          await deleteDraft(gmail, m.gmail_draft_id);
        } catch {
          // ignore
        }
      }
      await supabase
        .from("email_messages")
        .update({
          status: "archived",
          action_taken: "archived",
          gmail_draft_id: null,
          user_action_at: new Date().toISOString(),
        })
        .eq("id", m.id);
      if (label.default_action === "archive_after_24h") {
        await supabase.from("email_archive_audit").upsert({
          message_id: m.id,
          user_id: account.user_id,
          archived_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.warn(
        `[deferred-actions] failed for ${m.gmail_message_id}:`,
        (err as Error).message,
      );
      if (isRateLimitError(err)) {
        console.warn("[deferred-actions] rate limit hit, stopping early");
        break;
      }
    }
    deferredCount++;
    if (MS_BETWEEN_MESSAGES > 0) await sleep(MS_BETWEEN_MESSAGES);
  }
}

/**
 * Domains the user has APPROVED outgoing drafts to in the last 90 days.
 * Used by the relationship-domain safety rail.
 */
async function loadRecentRelationshipDomains(
  supabase: SupabaseClient,
  accountId: string,
  sinceISO: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("email_messages")
    .select("from_address")
    .eq("account_id", accountId)
    .eq("status", "approved")
    .gte("received_at", sinceISO);

  const set = new Set<string>();
  for (const row of data || []) {
    const r = row as Pick<EmailMessageRow, "from_address">;
    const domain = (r.from_address || "").split("@")[1]?.toLowerCase();
    if (domain) set.add(domain);
  }
  return set;
}
