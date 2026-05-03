import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { buildSystemPrompt } from "@/lib/prompts";
import { ALL_TOOLS, executeToolByName } from "@/lib/agent/tools";

export const runtime = "nodejs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ITERATIONS = 5;

type Attachment =
  | { type: "image"; mediaType: string; data: string }
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

  // 3. Load active memories + profile
  const [{ data: memories }, { data: profile }] = await Promise.all([
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

  const systemPrompt = buildSystemPrompt({
    personality: profile?.personality ?? "straight-talking-coach",
    memories: memories ?? [],
    timezone: profile?.timezone ?? "America/New_York",
  });

  // 4. Build initial messages
  const claudeMessages: Anthropic.MessageParam[] = history.slice(0, -1).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  // Latest user turn — include image blocks if attached
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
    contentBlocks.push({
      type: "text",
      text: userMessage || "What's in this image? Capture anything actionable.",
    });
    claudeMessages.push({ role: "user", content: contentBlocks });
  } else {
    claudeMessages.push({ role: "user", content: userMessage });
  }

  // 5. Tool-use loop
  let assistantText = "";
  const toolCallSummaries: string[] = [];

  try {
    let iterations = 0;
    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        tools: ALL_TOOLS,
        messages: claudeMessages,
      });

      // Append assistant response to message history
      claudeMessages.push({
        role: "assistant",
        content: response.content,
      });

      // If stop_reason isn't tool_use, we're done — extract final text
      if (response.stop_reason !== "tool_use") {
        for (const block of response.content) {
          if (block.type === "text") assistantText += block.text;
        }
        break;
      }

      // Otherwise execute each tool_use block and append results
      const toolResults: Array<{
        type: "tool_result";
        tool_use_id: string;
        content: string;
      }> = [];

      for (const block of response.content) {
        if (block.type === "tool_use") {
          const result = await executeToolByName(block.name, block.input, {
            supabase,
            userId: user.id,
          });
          toolCallSummaries.push(`${block.name}: ${result.summary}`);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
      }

      claudeMessages.push({ role: "user", content: toolResults });
    }

    // Safety: if we hit max iterations without resolution, surface that
    if (!assistantText && iterations >= MAX_TOOL_ITERATIONS) {
      assistantText = "(Reached max tool iterations — let me know if you need anything else.)";
    }
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
    attachments:
      toolCallSummaries.length > 0
        ? [{ type: "tool_calls", calls: toolCallSummaries }]
        : null,
  });

  return NextResponse.json({
    message: assistantText,
    tool_calls: toolCallSummaries,
  });
}
