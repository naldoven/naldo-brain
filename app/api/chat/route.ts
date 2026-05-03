import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { buildSystemPrompt } from "@/lib/prompts";

export const runtime = "nodejs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

// POST /api/chat — send a message, get response
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json();
  const userMessage: string = (body.message ?? "").toString().trim();
  if (!userMessage) {
    return NextResponse.json({ error: "empty message" }, { status: 400 });
  }

  // 1. Persist user message
  const { error: insErr } = await supabase.from("chat_messages").insert({
    user_id: user.id,
    role: "user",
    content: userMessage,
    channel: "web",
  });
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // 2. Load recent conversation (last 20 messages) for context
  const { data: recent } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  const history = (recent ?? [])
    .reverse()
    .filter((m) => m.role === "user" || m.role === "assistant");

  // 3. Load active long-term memories
  const { data: memories } = await supabase
    .from("memories")
    .select("subject, fact")
    .eq("user_id", user.id)
    .eq("active", true)
    .limit(40);

  // 4. Load profile for personality
  const { data: profile } = await supabase
    .from("profiles")
    .select("personality")
    .eq("id", user.id)
    .single();

  const systemPrompt = buildSystemPrompt({
    personality: profile?.personality ?? "straight-talking-coach",
    memories: memories ?? [],
  });

  // 5. Call Claude
  let assistantText = "";
  try {
    const completion = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: systemPrompt,
      messages: history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    const block = completion.content[0];
    assistantText =
      block && block.type === "text" ? block.text : "(no response)";
  } catch (err) {
    const message = err instanceof Error ? err.message : "Claude API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // 6. Persist assistant response
  await supabase.from("chat_messages").insert({
    user_id: user.id,
    role: "assistant",
    content: assistantText,
    channel: "web",
  });

  return NextResponse.json({ message: assistantText });
}
