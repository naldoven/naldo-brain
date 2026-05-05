/**
 * Per-email classification: build the prompt, call Claude, parse the JSON.
 *
 * Two paths:
 *  - classify(): legacy bucket-based (NEEDS_ATTENTION / ARCHIVE) — used when
 *    the account has zero labels defined.
 *  - classifyToLabel(): label-based — used when the account has 1+ labels.
 *    Includes recent corrections as few-shot examples.
 */

import {
  classifyEmail,
  classifyEmailWithLabels,
  CLASSIFICATION_SCHEMA,
} from "../anthropic";
import type {
  Classification,
  DefaultAction,
  EmailCorrectionRow,
  EmailLabelRow,
  EmailStyleOverridesRow,
  EmailVoiceProfileRow,
  FetchedEmail,
  LabelClassification,
} from "../types";

const ACTION_DESCRIPTIONS: Record<DefaultAction, string> = {
  archive_only: "Apply this label and archive immediately (remove from INBOX, kept in All Mail). Used for tagged-but-silent mail like resolved confirmations or filed promos.",
  trash_only: "Apply this label and TRASH the email immediately (Gmail Trash, auto-deletes in 30 days). Most aggressive — only pick this label for unambiguous spam or noise the user definitely never wants to see again.",
  archive_after_24h: "Apply this label, leave in Gmail INBOX for 24 hours so the user has a chance to glance at it directly in Gmail, then auto-archive. Off the agent's dashboard immediately. Used for newsletters and FYI mail he wants to skim today but not keep around.",
  trash_after_24h: "Apply this label, leave in Gmail INBOX for 24 hours, then auto-trash. Off the agent's dashboard immediately. Used for mail he wants one chance to see in Gmail, then gone. Aggressive but with a 24-hour grace period.",
  keep_in_inbox: "Apply this label, leave in inbox forever, do not surface to dashboard. Used for tagged FYI mail Naldo wants to glance at in Gmail directly.",
  surface_no_draft: "Apply this label, leave in inbox, surface in dashboard for review (no reply drafted). Used for things he must see but won't reply to.",
  surface_with_draft: "Apply this label, leave in inbox, surface in dashboard, AND draft a reply in his voice. Used for mail expecting a response.",
};

// ----------------------------------------------------------------------------
// Bucket-based classification (legacy, used when no labels are defined)
// ----------------------------------------------------------------------------

export function buildSystemPrompt(args: {
  accountEmail: string;
  voiceProfile: EmailVoiceProfileRow | null;
  styleOverrides: EmailStyleOverridesRow | null;
}): string {
  const voice = args.voiceProfile?.profile_text || "(no voice profile yet — write in plain, professional English)";
  const styleGuide = args.styleOverrides?.style_guide || "(no style guide yet)";
  const favorites = args.styleOverrides?.favorite_emails || "(no favorite emails yet)";
  const hardRules = args.styleOverrides?.hard_rules || "(no hard rules yet)";

  return `You are an inbox triage assistant for Naldo (Reginaldo Venegas), who runs Yule Love Lights — a holiday lighting business on Long Island — and is also Director of Operations at a Chick-fil-A. He's triaging the inbox: ${args.accountEmail}.

Your job for each email is to:
1. Decide whether it NEEDS HIS ATTENTION or can be ARCHIVED.
2. If it needs attention AND a reply is expected, draft the reply in his voice.

# When to ARCHIVE
ONLY archive if you are highly confident the email is one of these:
- Marketing newsletter or promotional blast (unsubscribe link, mass-list)
- Automated notification with no action needed
- Receipt for something he already knows about
- Cold sales pitch from a vendor he has no relationship with
- Read-receipt or auto-reply with no actual content

# When to surface (NEEDS_ATTENTION)
EVERYTHING else. Specifically, NEVER archive:
- Anything from a real person who knows him
- Customer mail (quote requests, install/takedown questions, complaints, payment issues, scheduling)
- Money / legal / banking / tax / invoices / contracts
- Vendor / supplier / contractor / ops mail tied to delivering jobs
- Personal mail (family, friends, doctors, kids' school)
- Anything CFA / Chick-fil-A related
- Anything with words like "urgent", "action required", "invoice", "tax", "wire", "lawsuit"

When in doubt — surface it.

# Confidence scoring
Be honest. Below 0.85 confidence will be surfaced regardless of bucket.

# Reply needed?
- TRUE: customer questions, vendor requests, anything where someone is asking him something or expecting a response.
- FALSE: FYI mail he should see but won't reply to.

# Voice
${voice}

# Style guide
${styleGuide}

# Examples of emails Naldo loves
${favorites}

# Hard rules (NEVER violate)
${hardRules}

# Output format
Return ONLY a single JSON object — no preamble, no explanation outside the JSON. The schema is:

${JSON.stringify(CLASSIFICATION_SCHEMA, null, 2)}

If reply_needed is false or bucket is ARCHIVE, set draft_subject and draft_body to empty strings ''.`;
}

export function buildUserContent(email: FetchedEmail): string {
  const threadHint = email.headers["in-reply-to"]
    ? `(This appears to be part of an existing thread — "In-Reply-To" header is set.)\n\n`
    : "";
  return `${threadHint}From: ${email.fromName ? `${email.fromName} <${email.fromAddress}>` : email.fromAddress}
To: ${email.toAddresses.join(", ")}
Subject: ${email.subject || "(no subject)"}
Received: ${email.receivedAt}

Body:
${email.bodyText.slice(0, 8000)}${email.bodyText.length > 8000 ? "\n\n[...truncated]" : ""}

Classify this email and respond with ONLY the JSON object.`;
}

export async function classify(args: {
  accountEmail: string;
  voiceProfile: EmailVoiceProfileRow | null;
  styleOverrides: EmailStyleOverridesRow | null;
  email: FetchedEmail;
}): Promise<Classification> {
  const systemPrompt = buildSystemPrompt({
    accountEmail: args.accountEmail,
    voiceProfile: args.voiceProfile,
    styleOverrides: args.styleOverrides,
  });
  const userContent = buildUserContent(args.email);
  return classifyEmail({ systemPrompt, userContent });
}

// ----------------------------------------------------------------------------
// Label-based classification
// ----------------------------------------------------------------------------

export function buildLabelSystemPrompt(args: {
  accountEmail: string;
  voiceProfile: EmailVoiceProfileRow | null;
  styleOverrides: EmailStyleOverridesRow | null;
  labels: EmailLabelRow[];
}): string {
  const voice = args.voiceProfile?.profile_text || "(no voice profile yet — write in plain, professional English)";
  const styleGuide = args.styleOverrides?.style_guide || "(no style guide yet)";
  const favorites = args.styleOverrides?.favorite_emails || "(no favorite emails yet)";
  const hardRules = args.styleOverrides?.hard_rules || "(no hard rules yet)";

  const labelsBlock = args.labels
    .map(
      (l) =>
        `- label_id: "${l.id}"\n  name: "${l.name}"\n  description: "${l.description || "(no description)"}"\n  default_action: ${l.default_action}\n  what that means: ${ACTION_DESCRIPTIONS[l.default_action]}`,
    )
    .join("\n\n");

  const draftLabelIds = args.labels
    .filter((l) => l.default_action === "surface_with_draft")
    .map((l) => `"${l.id}" (${l.name})`)
    .join(", ");

  return `You are an inbox triage assistant for Naldo (Reginaldo Venegas), who runs Yule Love Lights — a holiday lighting business on Long Island — and is also Director of Operations at a Chick-fil-A. He's triaging the inbox: ${args.accountEmail}.

Your job: pick exactly one label for each email — the label that best matches what the email IS — OR return null if nothing fits cleanly.

# Available labels for this inbox

${labelsBlock}

If no label fits clearly, return label_id: null.

# Confidence scoring
Be honest. Below 0.85 means "not sure" — those will be surfaced for review regardless of the label's default action.

# Voice (only used if you draft a reply)
${voice}

# Style guide
${styleGuide}

# Examples of emails Naldo loves
${favorites}

# Hard rules (NEVER violate)
${hardRules}

# Drafts
The following labels have default_action="surface_with_draft" — for these, you must draft a reply in Naldo's voice:
${draftLabelIds || "(none)"}

For all other labels (and for null), return draft_subject and draft_body as empty strings ''.

# Output format
Return ONLY a single JSON object — no preamble:

{
  "label_id": "<exact uuid from the label list above>" | null,
  "confidence": 0.0-1.0,
  "reason": "one short sentence (under 25 words)",
  "draft_subject": "..." | "",
  "draft_body": "..." | ""
}`;
}

function buildCorrectionsBlock(corrections: EmailCorrectionRow[]): string {
  if (corrections.length === 0) return "";
  const examples = corrections
    .slice(0, 15)
    .map((c, i) => {
      const fromDisplay = c.from_name
        ? `${c.from_name} <${c.from_address}>`
        : c.from_address;
      const subject = c.subject || "(no subject)";
      const snippet = (c.snippet || "").slice(0, 200);
      const fromLabel = c.original_label_name
        ? `previously "${c.original_label_name}"`
        : "previously uncategorized";
      const toLabel = c.corrected_label_name
        ? `Naldo re-labeled as "${c.corrected_label_name}"`
        : "Naldo removed the label";
      return `Example ${i + 1}:
  From: ${fromDisplay}
  Subject: ${subject}
  Snippet: ${snippet}
  → ${fromLabel}, ${toLabel}`;
    })
    .join("\n\n");
  return `# Recent labeling corrections (HIGH PRIORITY guidance)

Naldo manually re-labeled these recent emails. They're stronger signal than the label descriptions above. If a new email looks similar to one of these, prefer matching Naldo's labeling decision.

${examples}

---

`;
}

export async function classifyToLabel(args: {
  accountEmail: string;
  voiceProfile: EmailVoiceProfileRow | null;
  styleOverrides: EmailStyleOverridesRow | null;
  labels: EmailLabelRow[];
  corrections: EmailCorrectionRow[];
  email: FetchedEmail;
}): Promise<LabelClassification> {
  const systemPrompt = buildLabelSystemPrompt({
    accountEmail: args.accountEmail,
    voiceProfile: args.voiceProfile,
    styleOverrides: args.styleOverrides,
    labels: args.labels,
  });
  const correctionsBlock = buildCorrectionsBlock(args.corrections);
  const userContent = correctionsBlock + buildUserContent(args.email);
  return classifyEmailWithLabels({
    systemPrompt,
    userContent,
    validLabelIds: args.labels.map((l) => l.id),
  });
}
