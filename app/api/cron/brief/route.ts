/**
 * Generic briefing endpoint — called by Supabase pg_cron at scheduled times.
 * Body or query param `type` selects which brief: morning | eod | weekly | monthly.
 *
 * For each user with a phone set, generates a brief via Claude and sends via WhatsApp.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  gatherBriefContext,
  generateBriefText,
  extractAndSaveMemories,
  type BriefType,
} from "@/lib/agent/briefings";
import { sendWhatsAppMessage, isTwilioConfigured } from "@/lib/twilio";

export const runtime = "nodejs";

const VALID_TYPES: BriefType[] = ["morning", "eod", "weekly", "monthly"];

const TYPE_PREFIXES: Record<BriefType, string> = {
  morning: "🌅 Morning Briefing",
  eod: "🌙 End of Day",
  weekly: "📅 Sunday Review",
  monthly: "🎯 Monthly Check-in",
};

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = request.nextUrl;
  const typeParam = (url.searchParams.get("type") ?? "morning") as BriefType;
  if (!VALID_TYPES.includes(typeParam)) {
    return NextResponse.json(
      { error: "invalid_type", valid: VALID_TYPES },
      { status: 400 }
    );
  }

  if (!isTwilioConfigured()) {
    return NextResponse.json({ error: "twilio_not_configured" }, { status: 503 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  const supabase = createServerClient(supabaseUrl, serviceKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  });

  // Find all users with a phone number set (currently single-user, but loop-safe)
  const { data: profiles, error: profErr } = await supabase
    .from("profiles")
    .select("id, phone, timezone")
    .not("phone", "is", null);

  if (profErr) {
    return NextResponse.json({ error: profErr.message }, { status: 500 });
  }

  const sent: string[] = [];
  const failed: Array<{ user_id: string; error: string }> = [];

  for (const p of profiles ?? []) {
    try {
      const ctx = await gatherBriefContext(supabase, p.id, typeParam);
      const text = await generateBriefText(ctx, p.timezone ?? "America/New_York");
      if (!text.trim()) {
        failed.push({ user_id: p.id, error: "empty brief" });
        continue;
      }

      // EOD: also auto-extract long-term memories from today's messages
      let extractedMemories: { subject: string; fact: string }[] = [];
      if (typeParam === "eod") {
        try {
          extractedMemories = await extractAndSaveMemories(supabase, p.id);
        } catch (err) {
          console.warn("[brief/eod] memory extraction failed:", err);
        }
      }

      let fullBody = `*${TYPE_PREFIXES[typeParam]}*\n\n${text}`;

      // Append extracted memories so user sees what was added
      if (extractedMemories.length > 0) {
        const memList = extractedMemories
          .map((m) => `· [${m.subject}] ${m.fact}`)
          .join("\n");
        fullBody += `\n\n_🧠 New memories saved:_\n${memList}`;
      }

      // Persist to chat_messages so it shows in the web chat too
      await supabase.from("chat_messages").insert({
        user_id: p.id,
        role: "assistant",
        content: fullBody,
        channel: "whatsapp",
      });

      // Send via WhatsApp
      if (p.phone) {
        await sendWhatsAppMessage({ to: p.phone, body: fullBody });
      }
      sent.push(p.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ user_id: p.id, error: msg });
    }
  }

  return NextResponse.json({
    type: typeParam,
    sent: sent.length,
    failed: failed.length,
    details: failed.length > 0 ? failed : undefined,
    ts: new Date().toISOString(),
  });
}
