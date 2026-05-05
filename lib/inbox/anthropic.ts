/**
 * Anthropic client + helpers for the Inbox module.
 *
 * Model choice: claude-haiku-4-5 by default (best price/perf for triage
 * classification + voice-mimicking drafts). Override via env:
 *   ANTHROPIC_MODEL_INBOX=claude-sonnet-4-6
 *
 * Uses the same ANTHROPIC_API_KEY as the rest of naldo-brain.
 * Prompt caching enabled on the system prompt (voice profile + style guide
 * + label list — stable per-account, so high cache hit rate).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Classification, LabelClassification } from "./types";

let cachedClient: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY env var");
  }
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

export function getInboxModel(): string {
  return process.env.ANTHROPIC_MODEL_INBOX || "claude-haiku-4-5";
}

export const CLASSIFICATION_SCHEMA = {
  type: "object",
  properties: {
    bucket: {
      type: "string",
      enum: ["NEEDS_ATTENTION", "ARCHIVE"],
      description:
        "NEEDS_ATTENTION if Naldo should see this email (default for anything ambiguous). ARCHIVE only for clear noise.",
    },
    confidence: {
      type: "number",
      description:
        "Your confidence in the bucket choice, 0.0 to 1.0. Be honest. Below the threshold will be treated as 'needs human review'.",
    },
    reason: {
      type: "string",
      description: "One short sentence (under 25 words) explaining the bucket choice.",
    },
    reply_needed: {
      type: "boolean",
      description:
        "True if the email requires a written reply. False for FYI mail (notifications, auto-confirms) Naldo should still see but won't respond to.",
    },
    draft_subject: { type: "string" },
    draft_body: { type: "string" },
  },
  required: ["bucket", "confidence", "reason", "reply_needed", "draft_subject", "draft_body"],
  additionalProperties: false,
} as const;

export async function classifyEmail(args: {
  systemPrompt: string;
  userContent: string;
}): Promise<Classification> {
  const client = getAnthropic();
  // TODO: enable prompt caching once @anthropic-ai/sdk is upgraded to 0.40+
  // (current 0.32 typings don't have cache_control on TextBlockParam yet)
  const response = await client.messages.create({
    model: getInboxModel(),
    max_tokens: 2048,
    system: args.systemPrompt,
    messages: [{ role: "user", content: args.userContent }],
  });
  const firstText = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  if (!firstText) throw new Error("Claude returned no text block");
  const parsed = extractJson(firstText.text);
  validateClassification(parsed);
  return parsed;
}

export async function classifyEmailWithLabels(args: {
  systemPrompt: string;
  userContent: string;
  validLabelIds: string[];
}): Promise<LabelClassification> {
  const client = getAnthropic();
  // TODO: enable prompt caching once @anthropic-ai/sdk is upgraded to 0.40+
  const response = await client.messages.create({
    model: getInboxModel(),
    max_tokens: 2048,
    system: args.systemPrompt,
    messages: [{ role: "user", content: args.userContent }],
  });
  const firstText = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  if (!firstText) throw new Error("Claude returned no text block");
  const parsed = extractJson(firstText.text);
  return validateLabelClassification(parsed, args.validLabelIds);
}

export async function buildVoiceProfile(args: {
  accountEmail: string;
  sentEmails: { subject: string; body: string; to: string }[];
}): Promise<string> {
  const client = getAnthropic();
  const samples = args.sentEmails
    .slice(0, 30)
    .map(
      (e, i) =>
        `### Email ${i + 1}\nTo: ${e.to}\nSubject: ${e.subject}\n\n${e.body.slice(0, 800)}`,
    )
    .join("\n\n---\n\n");

  const response = await client.messages.create({
    model: getInboxModel(),
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `You're profiling a person's email writing voice so an AI assistant can draft replies that sound like them.

Email account: ${args.accountEmail}

Recent sent emails (${args.sentEmails.length} samples):

${samples}

Write a voice profile (300-500 words) covering:
- Typical tone (warm/formal/direct/playful/etc.)
- Sentence length and rhythm
- Common opening phrases (or how they tend to skip openings)
- Common closings and sign-offs
- Vocabulary quirks
- Formality level by recipient type if discernible
- Things they consistently DO
- Things they consistently AVOID
- Anything else distinctive

Write in second person ("You write in short, punchy sentences..."). Will be pasted directly into the system prompt of an email drafter.`,
      },
    ],
  });
  const firstText = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  if (!firstText) throw new Error("Claude returned no text block for voice profile");
  return firstText.text.trim();
}

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error(
      `Could not find JSON object in Claude response. First 200 chars: ${cleaned.slice(0, 200)}`,
    );
  }
  const jsonStr = cleaned.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(
      `Failed to parse JSON from Claude: ${(err as Error).message}. Raw: ${jsonStr.slice(0, 500)}`,
    );
  }
}

function validateClassification(obj: unknown): asserts obj is Classification {
  if (!obj || typeof obj !== "object") {
    throw new Error("Classification is not an object");
  }
  const c = obj as Record<string, unknown>;
  if (c.bucket !== "NEEDS_ATTENTION" && c.bucket !== "ARCHIVE") {
    throw new Error(`Invalid bucket: ${String(c.bucket)}`);
  }
  if (typeof c.confidence !== "number" || c.confidence < 0 || c.confidence > 1) {
    throw new Error(`Invalid confidence: ${String(c.confidence)}`);
  }
  if (typeof c.reason !== "string") throw new Error("Invalid reason");
  if (typeof c.reply_needed !== "boolean") throw new Error("Invalid reply_needed");
  if (typeof c.draft_subject !== "string") throw new Error("Invalid draft_subject");
  if (typeof c.draft_body !== "string") throw new Error("Invalid draft_body");
}

function validateLabelClassification(
  obj: unknown,
  validLabelIds: string[],
): LabelClassification {
  if (!obj || typeof obj !== "object") {
    throw new Error("Classification is not an object");
  }
  const c = obj as Record<string, unknown>;
  let labelId: string | null = null;
  if (c.label_id === null || c.label_id === "null" || c.label_id === "UNCATEGORIZED") {
    labelId = null;
  } else if (typeof c.label_id === "string" && c.label_id.length > 0) {
    if (validLabelIds.includes(c.label_id)) {
      labelId = c.label_id;
    } else {
      labelId = null;
    }
  }
  if (typeof c.confidence !== "number" || c.confidence < 0 || c.confidence > 1) {
    throw new Error(`Invalid confidence: ${String(c.confidence)}`);
  }
  if (typeof c.reason !== "string") throw new Error("Invalid reason");
  return {
    label_id: labelId,
    confidence: c.confidence,
    reason: c.reason,
    draft_subject: typeof c.draft_subject === "string" ? c.draft_subject : "",
    draft_body: typeof c.draft_body === "string" ? c.draft_body : "",
  };
}
