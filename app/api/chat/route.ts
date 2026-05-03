import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runChatLoop, type Attachment } from "@/lib/agent/run-chat-loop";

export const runtime = "nodejs";

// GET /api/chat — fetch recent messages
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, channel, attachments, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: data ?? [] });
}

// POST /api/chat — send message, run agent loop, return text
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json();
  const userMessage: string = (body.message ?? "").toString().trim();
  const attachments: Attachment[] = Array.isArray(body.attachments)
    ? body.attachments
    : [];

  if (!userMessage && attachments.length === 0) {
    return NextResponse.json({ error: "empty message" }, { status: 400 });
  }

  // 1. Persist user message
  const { error: insErr } = await supabase.from("chat_messages").insert({
    user_id: user.id,
    role: "user",
    content: userMessage || "(image)",
    channel: "web",
    attachments: attachments.length > 0 ? attachments : null,
  });
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // 2. Load history + memories + profile
  const [{ data: recent }, { data: memories }, { data: profile }] =
    await Promise.all([
      supabase
        .from("chat_messages")
        .select("role, content")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("memories")
        .select("subject, fact")
        .eq("user_id", user.id)
        .eq("active", true)
        .limit(40),
      supabase
        .from("profiles")
        .select("personality, timezone")
        .eq("id", user.id)
        .single(),
    ]);

  const history = (recent ?? [])
    .reverse()
    .filter((m): m is { role: "user" | "assistant"; content: string } =>
      m.role === "user" || m.role === "assistant"
    );

  // 3. Run the agent loop
  let result;
  try {
    result = await runChatLoop({
      supabase,
      userId: user.id,
      userMessage,
      attachments,
      // Slice off the last entry — that's the user's current message we just persisted.
      // The runChatLoop will re-add it as the latest turn.
      history: history.slice(0, -1),
      personality: profile?.personality ?? "straight-talking-coach",
      timezone: profile?.timezone ?? "America/New_York",
      memories: memories ?? [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Claude API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // 4. Persist assistant response
  await supabase.from("chat_messages").insert({
    user_id: user.id,
    role: "assistant",
    content: result.text,
    channel: "web",
    attachments: result.toolCalls.length > 0 ? result.toolCalls : null,
  });

  return NextResponse.json({
    message: result.text,
    tool_calls: result.toolCalls,
  });
}
