/**
 * Shared agent loop. Called by both /api/chat (web) and /api/whatsapp (incoming WhatsApp).
 * Runs Claude tool-use until end_turn, returns final text + structured tool calls.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ALL_TOOLS, executeToolByName, type ToolResult } from "@/lib/agent/tools";
import { buildSystemPrompt } from "@/lib/prompts";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ITERATIONS = 5;

export type ToolCallRecord = {
  type: "tool_call";
  name: string;
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
};

export type Attachment =
  | { type: "image"; mediaType: string; data: string };

export type ChatHistoryMsg = { role: "user" | "assistant"; content: string };

export type RunOptions = {
  supabase: SupabaseClient;
  userId: string;
  userMessage: string;
  attachments?: Attachment[];
  history: ChatHistoryMsg[];
  personality?: string;
  timezone?: string;
  memories?: Array<{ subject: string; fact: string }>;
};

export type RunResult = {
  text: string;
  toolCalls: ToolCallRecord[];
};

export async function runChatLoop(options: RunOptions): Promise<RunResult> {
  const {
    supabase,
    userId,
    userMessage,
    attachments = [],
    history,
    personality = "straight-talking-coach",
    timezone = "America/New_York",
    memories = [],
  } = options;

  const systemPrompt = buildSystemPrompt({ personality, memories, timezone });

  // Build initial messages
  const claudeMessages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Latest user turn
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

  let assistantText = "";
  const toolCalls: ToolCallRecord[] = [];
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

    claudeMessages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      for (const block of response.content) {
        if (block.type === "text") assistantText += block.text;
      }
      break;
    }

    // Execute tool calls
    const toolResults: Array<{
      type: "tool_result";
      tool_use_id: string;
      content: string;
    }> = [];

    for (const block of response.content) {
      if (block.type === "tool_use") {
        const result: ToolResult = await executeToolByName(
          block.name,
          block.input,
          { supabase, userId }
        );
        toolCalls.push({
          type: "tool_call",
          name: block.name,
          ok: result.ok,
          summary: result.summary,
          data: result.data,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
    }

    claudeMessages.push({ role: "user", content: toolResults });
  }

  if (!assistantText && iterations >= MAX_TOOL_ITERATIONS) {
    assistantText = "(Reached max tool iterations — let me know if you need anything else.)";
  }

  return { text: assistantText, toolCalls };
}
