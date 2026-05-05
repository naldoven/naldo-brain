/**
 * Hardcoded never-archive safety rails.
 *
 * Layered ON TOP of Claude's classification. If any rule trips, we override
 * a verdict-to-archive and surface the email instead. Bias toward false
 * positives (over-surfacing) over false negatives (wrong-archiving).
 */

import type { FetchedEmail, SafetyRailResult } from "../types";

// Subject keywords that should NEVER be archived.
const NEVER_ARCHIVE_SUBJECT_KEYWORDS = [
  "invoice", "payment due", "past due", "overdue",
  "wire", "ach", "deposit",
  "tax", "irs", "1099", "w-2", "w2",
  "lawsuit", "subpoena", "court", "legal notice",
  "contract", "estimate signed", "signed",
  "urgent", "action required", "action needed",
  "verify your", "expir", "warrant", "summons", "violation",
];

// Sender domain suffixes that should NEVER be archived.
const NEVER_ARCHIVE_DOMAIN_SUFFIXES = [
  ".gov", ".edu",
  "irs.gov", "ssa.gov", "uscourts.gov",
  "chase.com", "wellsfargo.com", "bankofamerica.com",
  "citi.com", "amex.com", "americanexpress.com",
  "capitalone.com", "discover.com",
  "stripe.com", "paypal.com",
  "intuit.com", "quickbooks.com",
];

// Specific email addresses that should never be archived. Naldo can extend
// this list as misclassifications are discovered.
const NEVER_ARCHIVE_SENDERS: string[] = [];

export function checkSafetyRails(email: FetchedEmail): SafetyRailResult {
  const subject = (email.subject || "").toLowerCase();
  const fromLower = email.fromAddress.toLowerCase();
  const fromDomain = fromLower.split("@")[1] || "";

  // Subject keywords (word-boundary match — substring caused false positives
  // like "ach" matching "Checkmarx" in cybersecurity newsletter subjects)
  for (const kw of NEVER_ARCHIVE_SUBJECT_KEYWORDS) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}`, "i");
    if (re.test(subject)) {
      return { blocked: true, ruleName: `subject_keyword:${kw}` };
    }
  }

  for (const suffix of NEVER_ARCHIVE_DOMAIN_SUFFIXES) {
    if (fromDomain === suffix || fromDomain.endsWith("." + suffix.replace(/^\./, ""))) {
      return { blocked: true, ruleName: `sender_domain:${suffix}` };
    }
  }

  if (NEVER_ARCHIVE_SENDERS.includes(fromLower)) {
    return { blocked: true, ruleName: `sender_allowlist:${fromLower}` };
  }

  // Real reply (In-Reply-To header set) — if someone is replying to a thread,
  // it's almost always something Naldo started or participated in.
  if (email.headers["in-reply-to"] || email.headers["references"]) {
    return { blocked: true, ruleName: "thread_reply" };
  }

  return { blocked: false, ruleName: null };
}

/**
 * Check whether `senderDomain` has been corresponded with — i.e., we approved
 * a draft to that domain. Caller passes in the precomputed set to avoid a
 * Supabase query per email.
 */
export function isRelationshipDomain(
  email: FetchedEmail,
  recentDomains: Set<string>,
): SafetyRailResult {
  const domain = email.fromAddress.split("@")[1]?.toLowerCase() || "";
  if (!domain) return { blocked: false, ruleName: null };
  if (recentDomains.has(domain)) {
    return { blocked: true, ruleName: `relationship_domain:${domain}` };
  }
  return { blocked: false, ruleName: null };
}
