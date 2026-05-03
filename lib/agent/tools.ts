/**
 * Agent tools — Claude calls these via tool use to create reminders/tasks/lists/memories.
 * Each tool has a schema (sent to Claude) and an executor (runs server-side with user's Supabase client).
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export type ToolContext = {
  supabase: SupabaseClient;
  userId: string;
};

export type ToolResult = {
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
};

type ToolDefinition = {
  schema: Anthropic.Tool;
  execute: (input: unknown, ctx: ToolContext) => Promise<ToolResult>;
};

// ============================================================================
// create_reminder
// ============================================================================
const CreateReminderInput = z.object({
  title: z.string().min(1).max(280),
  description: z.string().max(2000).optional(),
  fire_at: z
    .string()
    .describe("ISO 8601 datetime for when to fire — required for one-off reminders. For recurring, this is the first occurrence.")
    .optional(),
  rrule: z
    .string()
    .describe("RFC 5545 RRULE for recurring reminders, e.g. FREQ=DAILY or FREQ=MONTHLY;BYMONTHDAY=1. Omit for one-off.")
    .optional(),
  channels: z
    .array(z.enum(["whatsapp", "email", "sms", "push"]))
    .default(["whatsapp"]),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  emoji: z.string().max(4).optional(),
});

const createReminder: ToolDefinition = {
  schema: {
    name: "create_reminder",
    description:
      "Create a reminder. Use when the user asks to be reminded of something, or when a captured task has a clear due date. Always include fire_at. Use rrule for recurring.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short reminder title" },
        description: { type: "string", description: "Optional details" },
        fire_at: {
          type: "string",
          description:
            "ISO 8601 datetime when to fire (e.g. 2026-05-04T09:00:00Z). For recurring rules, this is the first occurrence.",
        },
        rrule: {
          type: "string",
          description:
            "RFC 5545 RRULE for recurring (e.g. 'FREQ=DAILY;BYHOUR=9' or 'FREQ=MONTHLY;BYMONTHDAY=1'). Omit for one-off.",
        },
        channels: {
          type: "array",
          items: { type: "string", enum: ["whatsapp", "email", "sms", "push"] },
          description: "Delivery channels. Default ['whatsapp'].",
        },
        priority: { type: "string", enum: ["high", "medium", "low"] },
        emoji: { type: "string", description: "Optional emoji for the reminder" },
      },
      required: ["title"],
    },
  },
  async execute(rawInput, ctx) {
    const parsed = CreateReminderInput.safeParse(rawInput);
    if (!parsed.success) {
      return { ok: false, summary: `Invalid input: ${parsed.error.message}` };
    }
    const input = parsed.data;

    const { data, error } = await ctx.supabase
      .from("reminders")
      .insert({
        user_id: ctx.userId,
        title: input.title,
        description: input.description ?? null,
        fire_at: input.fire_at ?? null,
        rrule: input.rrule ?? null,
        channels: input.channels,
        priority: input.priority,
        emoji: input.emoji ?? null,
        status: "active",
      })
      .select("id, title, fire_at, rrule")
      .single();

    if (error) return { ok: false, summary: `DB error: ${error.message}` };

    const recurrence = input.rrule ? "recurring" : "one-time";
    const when = input.fire_at
      ? new Date(input.fire_at).toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "no scheduled time";

    return {
      ok: true,
      summary: `Created ${recurrence} reminder "${data.title}" for ${when}. Channels: ${input.channels.join(", ")}.`,
      data: { reminder_id: data.id },
    };
  },
};

// ============================================================================
// create_task
// ============================================================================
const CreateTaskInput = z.object({
  title: z.string().min(1).max(280),
  description: z.string().max(2000).optional(),
  board_name: z
    .string()
    .describe(
      "Board to add the task to. Match against existing board names case-insensitively. If no match, falls back to 'All Tasks'."
    )
    .optional(),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  time_estimate: z.string().max(20).optional(),
  due_at: z.string().optional(),
});

const createTask: ToolDefinition = {
  schema: {
    name: "create_task",
    description:
      "Create a task on a Kanban board. Use when the user mentions a discrete action item with no urgent reminder needed.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short task title" },
        description: { type: "string" },
        board_name: {
          type: "string",
          description:
            "Board name to add to (e.g. 'YLL', 'Personal', 'Health'). Falls back to 'All Tasks' if no match.",
        },
        priority: { type: "string", enum: ["high", "medium", "low"] },
        time_estimate: {
          type: "string",
          description: "Estimate like '15m', '2h'. Optional.",
        },
        due_at: { type: "string", description: "ISO 8601 datetime" },
      },
      required: ["title"],
    },
  },
  async execute(rawInput, ctx) {
    const parsed = CreateTaskInput.safeParse(rawInput);
    if (!parsed.success) {
      return { ok: false, summary: `Invalid input: ${parsed.error.message}` };
    }
    const input = parsed.data;

    // Resolve board: fuzzy match by name, fallback to 'All Tasks'
    const { data: boards } = await ctx.supabase
      .from("boards")
      .select("id, name")
      .eq("user_id", ctx.userId);

    let boardId: string | null = null;
    if (input.board_name && boards) {
      const target = input.board_name.toLowerCase();
      const match = boards.find((b) => b.name.toLowerCase() === target);
      if (match) boardId = match.id;
      else {
        // partial match
        const partial = boards.find(
          (b) =>
            b.name.toLowerCase().includes(target) ||
            target.includes(b.name.toLowerCase())
        );
        if (partial) boardId = partial.id;
      }
    }
    if (!boardId && boards) {
      const fallback = boards.find((b) => b.name === "All Tasks");
      boardId = fallback?.id ?? boards[0]?.id ?? null;
    }

    const { data, error } = await ctx.supabase
      .from("tasks")
      .insert({
        user_id: ctx.userId,
        board_id: boardId,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        time_estimate: input.time_estimate ?? null,
        due_at: input.due_at ?? null,
        source: "web",
        status: "queue",
      })
      .select("id, title")
      .single();

    if (error) return { ok: false, summary: `DB error: ${error.message}` };

    const boardName = boards?.find((b) => b.id === boardId)?.name ?? "(no board)";
    return {
      ok: true,
      summary: `Added task "${data.title}" to board "${boardName}".`,
      data: { task_id: data.id },
    };
  },
};

// ============================================================================
// add_to_list
// ============================================================================
const AddToListInput = z.object({
  list_name: z.string().min(1).max(120),
  text: z.string().min(1).max(500),
  list_type: z
    .enum(["shopping", "todo", "project", "habit", "goal", "custom"])
    .default("custom"),
});

const addToList: ToolDefinition = {
  schema: {
    name: "add_to_list",
    description:
      "Add an item to a list. If the list doesn't exist, it will be created automatically. Use for shopping items, todo items, ideas, etc.",
    input_schema: {
      type: "object",
      properties: {
        list_name: {
          type: "string",
          description:
            "Name of list to add to. If no list with this name exists, it will be created.",
        },
        text: { type: "string", description: "The item text to add" },
        list_type: {
          type: "string",
          enum: ["shopping", "todo", "project", "habit", "goal", "custom"],
          description: "Type of list (only used if creating a new list)",
        },
      },
      required: ["list_name", "text"],
    },
  },
  async execute(rawInput, ctx) {
    const parsed = AddToListInput.safeParse(rawInput);
    if (!parsed.success) {
      return { ok: false, summary: `Invalid input: ${parsed.error.message}` };
    }
    const input = parsed.data;

    // Find list (case-insensitive) or create it
    const { data: existing } = await ctx.supabase
      .from("lists")
      .select("id, name")
      .eq("user_id", ctx.userId)
      .ilike("name", input.list_name)
      .limit(1)
      .maybeSingle();

    let listId = existing?.id;
    let listName = existing?.name;
    let created = false;

    if (!listId) {
      const emojiByType: Record<string, string> = {
        shopping: "🛒",
        todo: "✅",
        project: "🏗️",
        habit: "💪",
        goal: "🎯",
        custom: "📋",
      };
      const { data: newList, error: createErr } = await ctx.supabase
        .from("lists")
        .insert({
          user_id: ctx.userId,
          name: input.list_name,
          type: input.list_type,
          emoji: emojiByType[input.list_type] ?? "📋",
        })
        .select("id, name")
        .single();
      if (createErr || !newList) {
        return { ok: false, summary: `Failed to create list: ${createErr?.message ?? "unknown"}` };
      }
      listId = newList.id;
      listName = newList.name;
      created = true;
    }

    const { error: itemErr } = await ctx.supabase.from("list_items").insert({
      list_id: listId,
      user_id: ctx.userId,
      text: input.text,
      source: "web",
    });

    if (itemErr) return { ok: false, summary: `DB error: ${itemErr.message}` };

    return {
      ok: true,
      summary: created
        ? `Created new "${listName}" list and added "${input.text}".`
        : `Added "${input.text}" to "${listName}".`,
    };
  },
};

// ============================================================================
// save_memory
// ============================================================================
const SaveMemoryInput = z.object({
  subject: z
    .string()
    .min(1)
    .max(80)
    .describe(
      "Either 'user' for things about Naldo, or a contact name (e.g. 'David', 'Laura')."
    ),
  fact: z.string().min(1).max(500),
});

const saveMemory: ToolDefinition = {
  schema: {
    name: "save_memory",
    description:
      "Save a long-term fact about the user or a contact. Use when the user shares a preference, rule, or biographical fact you should remember in future conversations.",
    input_schema: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          description:
            "'user' for facts about Naldo, or a contact's name (e.g. 'David', 'Laura', 'Mom').",
        },
        fact: {
          type: "string",
          description: "The fact to remember, in one sentence.",
        },
      },
      required: ["subject", "fact"],
    },
  },
  async execute(rawInput, ctx) {
    const parsed = SaveMemoryInput.safeParse(rawInput);
    if (!parsed.success) {
      return { ok: false, summary: `Invalid input: ${parsed.error.message}` };
    }
    const input = parsed.data;

    const { error } = await ctx.supabase.from("memories").insert({
      user_id: ctx.userId,
      subject: input.subject,
      fact: input.fact,
      active: true,
    });

    if (error) return { ok: false, summary: `DB error: ${error.message}` };

    return {
      ok: true,
      summary: `Saved memory: [${input.subject}] ${input.fact}`,
    };
  },
};

// ============================================================================
// flag_avoidance
// ============================================================================
const FlagAvoidanceInput = z.object({
  title: z.string().min(1).max(280),
  description: z.string().max(2000).optional(),
});

const flagAvoidance: ToolDefinition = {
  schema: {
    name: "flag_avoidance",
    description:
      "Flag something the user is avoiding. Adds it to the Avoidance Radar so it surfaces on the dashboard. Use when the user explicitly says they're avoiding/dodging/procrastinating on something.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short title of what they're avoiding",
        },
        description: { type: "string", description: "More context if useful" },
      },
      required: ["title"],
    },
  },
  async execute(rawInput, ctx) {
    const parsed = FlagAvoidanceInput.safeParse(rawInput);
    if (!parsed.success) {
      return { ok: false, summary: `Invalid input: ${parsed.error.message}` };
    }
    const input = parsed.data;

    const { error } = await ctx.supabase.from("avoidance_items").insert({
      user_id: ctx.userId,
      title: input.title,
      description: input.description ?? null,
      flagged: true,
      flagged_at: new Date().toISOString(),
    });

    if (error) return { ok: false, summary: `DB error: ${error.message}` };

    return {
      ok: true,
      summary: `Flagged on Avoidance Radar: "${input.title}".`,
    };
  },
};

// ============================================================================
// create_event — calendar event
// ============================================================================
const CreateEventInput = z.object({
  title: z.string().min(1).max(280),
  description: z.string().max(2000).optional(),
  starts_at: z
    .string()
    .describe("ISO 8601 datetime when the event starts"),
  ends_at: z
    .string()
    .describe("ISO 8601 datetime when the event ends. Defaults to 1h after start.")
    .optional(),
  all_day: z.boolean().default(false),
  color: z.string().max(20).optional(),
});

const createEvent: ToolDefinition = {
  schema: {
    name: "create_event",
    description:
      "Create a calendar event. Use when the user mentions a meeting, appointment, or scheduled time-bound activity (not a reminder).",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        starts_at: { type: "string", description: "ISO 8601 datetime when event starts" },
        ends_at: { type: "string", description: "ISO 8601 datetime when event ends (default: starts_at + 1h)" },
        all_day: { type: "boolean", description: "True for all-day events" },
        color: { type: "string", description: "Hex color, optional" },
      },
      required: ["title", "starts_at"],
    },
  },
  async execute(rawInput, ctx) {
    const parsed = CreateEventInput.safeParse(rawInput);
    if (!parsed.success) {
      return { ok: false, summary: `Invalid input: ${parsed.error.message}` };
    }
    const input = parsed.data;

    const startsAt = new Date(input.starts_at);
    const endsAt = input.ends_at
      ? new Date(input.ends_at)
      : new Date(startsAt.getTime() + 60 * 60 * 1000);

    const { data, error } = await ctx.supabase
      .from("calendar_events")
      .insert({
        user_id: ctx.userId,
        title: input.title,
        description: input.description ?? null,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        all_day: input.all_day,
        color: input.color ?? "#6366F1",
        source: "local",
      })
      .select("id, title, starts_at")
      .single();

    if (error) return { ok: false, summary: `DB error: ${error.message}` };

    const when = startsAt.toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: input.all_day ? undefined : "short",
    });
    return {
      ok: true,
      summary: `Scheduled "${data.title}" for ${when}.`,
      data: { event_id: data.id },
    };
  },
};

// ============================================================================
// Registry
// ============================================================================
export const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  create_reminder: createReminder,
  create_task: createTask,
  add_to_list: addToList,
  save_memory: saveMemory,
  flag_avoidance: flagAvoidance,
  create_event: createEvent,
};

export const ALL_TOOLS: Anthropic.Tool[] = Object.values(TOOL_REGISTRY).map(
  (t) => t.schema
);

export async function executeToolByName(
  name: string,
  input: unknown,
  ctx: ToolContext
): Promise<ToolResult> {
  const tool = TOOL_REGISTRY[name];
  if (!tool) return { ok: false, summary: `Unknown tool: ${name}` };
  try {
    return await tool.execute(input, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, summary: `Tool ${name} threw: ${msg}` };
  }
}
