import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  sendWhatsAppMessage,
  sendWhatsAppContentTemplate,
  isTwilioConfigured,
} from "@/lib/twilio";
import { computeNextFire, formatReminderMessage } from "@/lib/rrule-helpers";

export const runtime = "nodejs";

/**
 * Fires due reminders. Called by Supabase pg_cron every minute.
 *
 * Authentication: requires header `x-cron-secret` matching CRON_SECRET env var.
 *
 * Uses the SUPABASE service-role key to bypass RLS — set SUPABASE_SERVICE_ROLE_KEY env var.
 * (We don't use the anon key here because it can't UPDATE other users' reminders.)
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isTwilioConfigured()) {
    return NextResponse.json(
      { error: "twilio_not_configured", note: "Set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN" },
      { status: 503 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      {
        error: "supabase_not_configured",
        missing: {
          NEXT_PUBLIC_SUPABASE_URL: !supabaseUrl,
          SUPABASE_SERVICE_ROLE_KEY: !serviceKey,
        },
        // List which SUPABASE_-prefixed env vars exist (names only, no values)
        env_keys_present: Object.keys(process.env)
          .filter((k) => k.startsWith("SUPABASE") || k.startsWith("NEXT_PUBLIC_SUPABASE"))
          .sort(),
      },
      { status: 503 }
    );
  }

  // Service-role client — bypasses RLS so we can read/update across all users.
  const supabase = createServerClient(supabaseUrl, serviceKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  });

  // Pull all due reminders. SKIP LOCKED would be better; using simple SELECT for now.
  const now = new Date();
  const { data: due, error: fetchError } = await supabase
    .from("reminders")
    .select(
      "id, user_id, title, description, fire_at, rrule, channels, emoji, status, last_fired_at"
    )
    .eq("status", "active")
    .lte("fire_at", now.toISOString())
    .limit(50);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!due || due.length === 0) {
    return NextResponse.json({ fired: 0, ts: now.toISOString() });
  }

  const fired: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const r of due) {
    // Skip if already fired in last 60s (idempotency safety)
    if (r.last_fired_at && new Date(r.last_fired_at).getTime() > now.getTime() - 60_000) {
      continue;
    }

    // Look up phone for the user
    const { data: profile } = await supabase
      .from("profiles")
      .select("phone")
      .eq("id", r.user_id)
      .single();

    const phone = profile?.phone;
    const channels: string[] = r.channels ?? ["whatsapp"];
    const wantsWhatsApp = channels.includes("whatsapp");

    if (!wantsWhatsApp || !phone) {
      // Nothing to send — log it and advance.
      await supabase.from("reminder_logs").insert({
        reminder_id: r.id,
        user_id: r.user_id,
        channel: wantsWhatsApp ? "whatsapp" : (channels[0] ?? "unknown"),
        status: "failed",
        error: !phone ? "no_phone_on_profile" : "no_whatsapp_channel",
      });
      // Still advance the recurrence so we don't keep re-firing.
      await advanceReminder(supabase, r, now);
      continue;
    }

    try {
      const body = formatReminderMessage({
        title: r.title,
        description: r.description,
        emoji: r.emoji,
      });

      // Quick Reply Content Template if available — gives "Done / 1h / Tomorrow"
      // buttons in WhatsApp. Otherwise plain text with manual instructions so
      // the user can still type "done" / "1h" / "tomorrow" to ack.
      const templateSid = process.env.TWILIO_REMINDER_TEMPLATE_SID;
      if (templateSid) {
        await sendWhatsAppContentTemplate({
          to: phone,
          contentSid: templateSid,
          variables: {
            "1": body,           // body text — wired to {{1}} in the template
            "2": r.id,           // reminder id — wired into each button payload as {{2}}
          },
        });
      } else {
        await sendWhatsAppMessage({
          to: phone,
          body: `${body}\n\nReply *done*, *1h*, or *tomorrow*.`,
        });
      }
      await supabase.from("reminder_logs").insert({
        reminder_id: r.id,
        user_id: r.user_id,
        channel: "whatsapp",
        status: "sent",
      });
      await advanceReminder(supabase, r, now);
      fired.push(r.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ id: r.id, error: msg });
      await supabase.from("reminder_logs").insert({
        reminder_id: r.id,
        user_id: r.user_id,
        channel: "whatsapp",
        status: "failed",
        error: msg,
      });
    }
  }

  return NextResponse.json({
    fired: fired.length,
    failed: failed.length,
    ts: now.toISOString(),
    details: failed.length > 0 ? failed : undefined,
  });
}

type ReminderRow = {
  id: string;
  user_id: string;
  rrule: string | null;
  fire_at: string | null;
};

// Memorae-style behavior: one-off reminders re-poll daily until you ack or
// they hit the cap. Tap Done at any point and they stop. Hit the cap and the
// avoidance auto-flagger picks them up as something you're dodging.
const ONE_OFF_REFIRE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ONE_OFF_MAX_FIRES = 5;

async function advanceReminder(
  supabase: ReturnType<typeof createServerClient>,
  r: ReminderRow,
  now: Date
) {
  const next = computeNextFire({ rrule: r.rrule, fireAt: r.fire_at, from: now });

  if (next) {
    // Recurring — schedule next occurrence; status stays 'active' so it
    // continues firing on schedule. Per-fire counts come from reminder_logs.
    await supabase
      .from("reminders")
      .update({
        last_fired_at: now.toISOString(),
        fire_at: next.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", r.id);
    return;
  }

  // One-off — count how many times we've fired this in the last 30 days.
  // The log row for THIS fire was already inserted before advanceReminder
  // runs, so the count includes it.
  const since = new Date(now.getTime() - 30 * 86400000).toISOString();
  const { count: firedCount } = await supabase
    .from("reminder_logs")
    .select("*", { count: "exact", head: true })
    .eq("reminder_id", r.id)
    .eq("status", "sent")
    .gte("fired_at", since);

  const fires = firedCount ?? 1;

  if (fires < ONE_OFF_MAX_FIRES) {
    // Re-arm for tomorrow. Status stays 'active' so the cron picks it up
    // at the new fire_at. The user can stop the cycle by tapping Done or
    // Cancelled.
    await supabase
      .from("reminders")
      .update({
        last_fired_at: now.toISOString(),
        fire_at: new Date(now.getTime() + ONE_OFF_REFIRE_INTERVAL_MS).toISOString(),
        status: "active",
        updated_at: now.toISOString(),
      })
      .eq("id", r.id);
  } else {
    // Capped — stop firing. Status='fired' is the avoidance signal: the
    // hourly auto_flag_avoidance() will surface it on /avoidance.
    await supabase
      .from("reminders")
      .update({
        last_fired_at: now.toISOString(),
        status: "fired",
        updated_at: now.toISOString(),
      })
      .eq("id", r.id);
  }
}

// GET for monitoring / health check (auth-protected the same way)
export async function GET(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    twilio_configured: isTwilioConfigured(),
    supabase_configured: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ),
    ok: true,
  });
}
