/**
 * Action handlers for reminders received via WhatsApp button taps OR plain-text
 * replies. Pure functions: take supabase + reminder id + (for snooze) duration,
 * mutate the reminders row, log the action, and return a confirmation message
 * to send back to the user.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type ActionId = "done" | "snooze_1h" | "snooze_tomorrow";

const SNOOZE_DURATIONS_MS: Record<Exclude<ActionId, "done">, number> = {
  snooze_1h: 60 * 60 * 1000,
  snooze_tomorrow: 24 * 60 * 60 * 1000,
};

/** Returns a short confirmation string to send back, or null if the reminder doesn't exist / isn't owned. */
export async function handleReminderAction(opts: {
  supabase: SupabaseClient;
  userId: string;
  reminderId: string;
  action: ActionId;
}): Promise<string | null> {
  const { supabase, userId, reminderId, action } = opts;

  // Confirm ownership before mutating (defense in depth — service-role bypasses RLS)
  const { data: reminder } = await supabase
    .from("reminders")
    .select("id, title, status")
    .eq("id", reminderId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!reminder) return null;

  const now = new Date();
  const nowIso = now.toISOString();

  if (action === "done") {
    await supabase
      .from("reminders")
      .update({
        status: "completed",
        acked_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", reminderId);

    await supabase.from("reminder_logs").insert({
      reminder_id: reminderId,
      user_id: userId,
      channel: "whatsapp",
      status: "acked",
    });

    return `✅ Marked done: ${reminder.title}`;
  }

  // Snooze actions
  const delta = SNOOZE_DURATIONS_MS[action];
  if (!delta) return null;

  const nextFire = new Date(now.getTime() + delta);
  await supabase
    .from("reminders")
    .update({
      status: "active",                   // make sure snoozed-while-completed re-arms
      fire_at: nextFire.toISOString(),
      acked_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", reminderId);

  await supabase.from("reminder_logs").insert({
    reminder_id: reminderId,
    user_id: userId,
    channel: "whatsapp",
    status: "acked",
  });

  const human = action === "snooze_1h" ? "1 hour" : "tomorrow";
  return `🕐 Snoozed ${human}: ${reminder.title}`;
}

/**
 * Resolve a plain-text reply ("done", "1h", "tomorrow", etc.) into an action id.
 * Returns null if the message doesn't look like a reminder ack.
 */
export function parseTextActionReply(message: string): ActionId | null {
  const t = message.trim().toLowerCase();
  // "done" / "✅" / "did it" / "complete"
  if (/^(done|did it|✅|completed?|finished)$/.test(t)) return "done";
  // "1h" / "in 1 hour" / "remind me in 1 hour" / "snooze 1h"
  if (/(^|\s)(in\s+)?1\s*h(our|r)?$/.test(t) || /^remind\s+me\s+in\s+1\s*h(our|r)?$/.test(t) || /^snooze\s+1h$/.test(t))
    return "snooze_1h";
  // "tomorrow" / "remind me tomorrow" / "tmrw"
  if (/^(tomorrow|tmrw|remind\s+me\s+tomorrow)$/.test(t)) return "snooze_tomorrow";
  return null;
}

/**
 * Find the most recent reminder fired to this user for plain-text reply
 * disambiguation. We assume "done"/"1h"/"tomorrow" answers the *latest* fire
 * within a 12h window — past that, ignore (probably unrelated message).
 */
export async function findRecentlyFiredReminder(
  supabase: SupabaseClient,
  userId: string
): Promise<{ id: string; title: string } | null> {
  const twelveHoursAgo = new Date(Date.now() - 12 * 3600_000).toISOString();

  // reminder_logs records each fire — pull the most recent "sent" entry
  const { data: log } = await supabase
    .from("reminder_logs")
    .select("reminder_id")
    .eq("user_id", userId)
    .eq("status", "sent")
    .gte("fired_at", twelveHoursAgo)
    .order("fired_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!log?.reminder_id) return null;

  const { data: reminder } = await supabase
    .from("reminders")
    .select("id, title")
    .eq("id", log.reminder_id)
    .eq("user_id", userId)
    .maybeSingle();

  return reminder ?? null;
}

/** Decode a button payload of the form `<action>:<reminder_id>`. Returns null on malformed input. */
export function parseButtonPayload(
  payload: string
): { action: ActionId; reminderId: string } | null {
  const [actionRaw, ...rest] = payload.split(":");
  if (!actionRaw || rest.length === 0) return null;
  const reminderId = rest.join(":");
  if (!reminderId) return null;
  const action = actionRaw as ActionId;
  if (action !== "done" && action !== "snooze_1h" && action !== "snooze_tomorrow") {
    return null;
  }
  return { action, reminderId };
}
