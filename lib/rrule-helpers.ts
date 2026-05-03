import { RRule } from "rrule";

/**
 * Compute the next fire time for a reminder.
 * - One-off reminders: returns the original fire_at if not yet fired, else null.
 * - Recurring reminders: returns the next occurrence after `from`.
 */
export function computeNextFire({
  rrule,
  fireAt,
  from = new Date(),
}: {
  rrule: string | null;
  fireAt: string | Date | null;
  from?: Date;
}): Date | null {
  if (!rrule) {
    if (!fireAt) return null;
    const fa = typeof fireAt === "string" ? new Date(fireAt) : fireAt;
    return fa > from ? fa : null;
  }

  try {
    // Need a DTSTART for rrule.js — use fireAt or now
    const dtstart =
      fireAt != null
        ? typeof fireAt === "string"
          ? new Date(fireAt)
          : fireAt
        : new Date();
    const ruleStr = rrule.includes("DTSTART")
      ? rrule
      : `DTSTART:${formatRRuleDate(dtstart)}\nRRULE:${rrule}`;
    const rule = RRule.fromString(ruleStr);
    return rule.after(from, false);
  } catch {
    return null;
  }
}

function formatRRuleDate(d: Date): string {
  // YYYYMMDDTHHmmssZ format required by RFC 5545
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/**
 * Format a Reminder for delivery via WhatsApp.
 */
export function formatReminderMessage(r: {
  title: string;
  description?: string | null;
  emoji?: string | null;
}): string {
  const emoji = r.emoji ?? "🔔";
  let body = `${emoji} ${r.title}`;
  if (r.description) body += `\n${r.description}`;
  return body;
}
