/**
 * Incoming WhatsApp webhook from Twilio. Replaces the old Express backend.
 *
 * Flow:
 *  1. Twilio POSTs form-encoded webhook → we validate signature
 *  2. Look up user by phone number (profiles.phone)
 *  3. Save user message to chat_messages
 *  4. Return TwiML empty response immediately (Twilio needs <15s)
 *  5. Async: run agent loop → send Brain's reply via Twilio REST API
 *
 * Configure Twilio Console webhook to:
 *   POST https://naldo-brain.onrender.com/api/whatsapp
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { runChatLoop } from "@/lib/agent/run-chat-loop";
import {
  validateTwilioRequest,
  sendWhatsAppMessage,
  isTwilioConfigured,
} from "@/lib/twilio";

export const runtime = "nodejs";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twimlResponse(): Response {
  return new Response(EMPTY_TWIML, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(request: NextRequest) {
  // 0. Configuration sanity check
  if (!isTwilioConfigured()) {
    return NextResponse.json(
      { error: "twilio_not_configured" },
      { status: 503 }
    );
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "supabase_not_configured" },
      { status: 503 }
    );
  }

  // 1. Parse form body (Twilio sends application/x-www-form-urlencoded)
  const rawBody = await request.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody)) as Record<
    string,
    string
  >;

  // 2. Validate Twilio signature
  // Reconstruct full URL Twilio used (Render is behind a proxy)
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const url = `${proto}://${host}/api/whatsapp`;
  const signature = request.headers.get("x-twilio-signature") ?? "";

  if (!validateTwilioRequest(signature, url, params)) {
    console.warn("[whatsapp] invalid signature for", url);
    return new Response("Forbidden", { status: 403 });
  }

  // 3. Extract message + sender
  const fromRaw = params.From ?? ""; // e.g. "whatsapp:+15551234567"
  const phone = fromRaw.replace(/^whatsapp:/, "").replace(/\s+/g, "");
  const userMessage = (params.Body ?? "").toString().trim();
  const numMedia = parseInt(params.NumMedia ?? "0", 10);

  if (!phone) {
    return twimlResponse();
  }

  // 4. Service-role Supabase client (bypasses RLS)
  const supabase = createServerClient(supabaseUrl, serviceKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  });

  // 5. Look up user by phone
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, personality, timezone")
    .eq("phone", phone)
    .maybeSingle();

  if (!profile) {
    // Unknown sender — kick back a friendly note (only works inside their 24h sandbox session)
    try {
      await sendWhatsAppMessage({
        to: phone,
        body: "👋 I don't recognize this number. Sign in at https://naldo-brain.onrender.com and add it to your profile.",
      });
    } catch (err) {
      console.error("[whatsapp] reply to unknown sender failed:", err);
    }
    return twimlResponse();
  }

  const userId = profile.id;

  // 6. Persist incoming message right away (so it shows in chat history even if agent is slow)
  if (userMessage || numMedia > 0) {
    await supabase.from("chat_messages").insert({
      user_id: userId,
      role: "user",
      content: userMessage || "(media)",
      channel: "whatsapp",
      attachments:
        numMedia > 0
          ? [{ type: "media", count: numMedia, urls: collectMediaUrls(params) }]
          : null,
    });
  }

  // 7. Async: run agent + send reply (don't block the TwiML response)
  // Render keeps the Node process alive between requests, so fire-and-forget is OK here.
  void processIncomingAsync({
    supabase,
    userId,
    userMessage,
    phone,
    timezone: profile.timezone ?? "America/New_York",
    personality: profile.personality ?? "straight-talking-coach",
  }).catch((err) => {
    console.error("[whatsapp] async processing failed:", err);
  });

  return twimlResponse();
}

function collectMediaUrls(
  params: Record<string, string>
): { url: string; contentType: string }[] {
  const out: { url: string; contentType: string }[] = [];
  for (let i = 0; i < 10; i++) {
    const url = params[`MediaUrl${i}`];
    if (!url) break;
    out.push({ url, contentType: params[`MediaContentType${i}`] ?? "" });
  }
  return out;
}

async function processIncomingAsync(opts: {
  supabase: ReturnType<typeof createServerClient>;
  userId: string;
  userMessage: string;
  phone: string;
  timezone: string;
  personality: string;
}) {
  const { supabase, userId, userMessage, phone, timezone, personality } = opts;

  // Load recent chat history (web + WhatsApp combined — same conversation thread)
  const [{ data: recent }, { data: memories }] = await Promise.all([
    supabase
      .from("chat_messages")
      .select("role, content")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("memories")
      .select("subject, fact")
      .eq("user_id", userId)
      .eq("active", true)
      .limit(40),
  ]);

  const history = ((recent ?? []) as Array<{ role: string; content: string }>)
    .reverse()
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        m.role === "user" || m.role === "assistant"
    )
    // Slice off the user message we just persisted — runChatLoop adds the latest turn itself
    .slice(0, -1);

  let result;
  try {
    result = await runChatLoop({
      supabase,
      userId,
      userMessage,
      history,
      personality,
      timezone,
      memories: memories ?? [],
    });
  } catch (err) {
    console.error("[whatsapp] runChatLoop failed:", err);
    try {
      await sendWhatsAppMessage({
        to: phone,
        body: "⚠️ Something went wrong on my end. Try again in a moment?",
      });
    } catch (sendErr) {
      console.error("[whatsapp] error reply failed:", sendErr);
    }
    return;
  }

  // Persist assistant response
  await supabase.from("chat_messages").insert({
    user_id: userId,
    role: "assistant",
    content: result.text,
    channel: "whatsapp",
    attachments: result.toolCalls.length > 0 ? result.toolCalls : null,
  });

  // Send Brain's reply back via WhatsApp
  if (result.text.trim()) {
    try {
      await sendWhatsAppMessage({ to: phone, body: result.text });
    } catch (err) {
      console.error("[whatsapp] sending reply failed:", err);
    }
  }
}
