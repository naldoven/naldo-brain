import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { buildSystemPrompt } from "@/lib/prompts";

export const runtime = "nodejs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type Attachment =
  | { type: "image"; mediaType: string; data: string } // base64 data URL or raw base64
  | { type: "url"; url: string };

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

// POST /api/chat — send a message (optionally with image), get response
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

  // 1. Persist user message (with attachment metadata)
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

  // 5. Build the Claude messages array
  // History stays as plain text. Current turn includes image content blocks if attached.
  const claudeMessages: Anthropic.MessageParam[] = history.slice(0, -1).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  // Latest user turn — include image blocks
  if (attachments.length > 0) {
    const contentBlocks: Array<
      | { type: "text"; text: string }
      | {
          type: "image";
          source: {
            type: "base64";
            media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
            data: string;
          };
        }
    > = [];
    for (const att of attachments) {
      if (att.type === "image") {
        // Strip data URL prefix if present
        const data = att.data.startsWith("data:")
          ? att.data.substring(att.data.indexOf(",") + 1)
          : att.data;
        contentBlocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: att.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data,
          },
        });
      }
    }
    if (userMessage) {
      contentBlocks.push({ type: "text", text: userMessage });
    } else {
      contentBlocks.push({
        type: "text",
        text: "What's in this image? Capture anything actionable.",
      });
    }
    claudeMessages.push({ role: "user", content: contentBlocks });
  } else {
    claudeMessages.push({ role: "user", content: userMessage });
  }

  // 6. Call Claude
  let assistantText = "";
  try {
    const completion = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: systemPrompt,
      messages: claudeMessages,
    });

    const block = completion.content[0];
    assistantText =
      block && block.type === "text" ? block.text : "(no response)";
  } catch (err) {
    const message = err instanceof Error ? err.message : "Claude API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // 7. Persist assistant response
  await supabase.from("chat_messages").insert({
    user_id: user.id,
    role: "assistant",
    content: assistantText,
    channel: "web",
  });

  return NextResponse.json({ message: assistantText });
}
