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

    // Dedupe: if there's already an open reminder (active OR fired) with the
    // same title, bump its fire_at + reset to active instead of inserting a
    // new row. Naldo saying "remind me to call mom" three different days
    // shouldn't create three rows.
    const { data: existing } = await ctx.supabase
      .from("reminders")
      .select("id, title, status, fire_at, rrule")
      .eq("user_id", ctx.userId)
      .ilike("title", input.title)
      .in("status", ["active", "fired"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      const updates: Record<string, unknown> = {
        status: "active",
        updated_at: new Date().toISOString(),
      };
      if (input.fire_at) updates.fire_at = input.fire_at;
      if (input.rrule) updates.rrule = input.rrule;
      if (input.description) updates.description = input.description;
      if (input.emoji) updates.emoji = input.emoji;
      updates.priority = input.priority;
      updates.channels = input.channels;

      await ctx.supabase
        .from("reminders")
        .update(updates)
        .eq("id", existing.id);

      const when = input.fire_at
        ? new Date(input.fire_at).toLocaleString("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
          })
        : "the existing schedule";
      return {
        ok: true,
        summary: `Already had a reminder for "${existing.title}" — bumped it to fire at ${when}.`,
        data: { reminder_id: existing.id, deduped: true },
      };
    }

    // Default fire_at to the next 6:20 AM in Naldo's tz when the LLM didn't
    // give us one — better than leaving fire_at NULL (the cron will never
    // pick it up). 6:20 AM is intentional: 10 min before the morning brief.
    const fireAt = input.fire_at ?? defaultFireAt();

    const { data, error } = await ctx.supabase
      .from("reminders")
      .insert({
        user_id: ctx.userId,
        title: input.title,
        description: input.description ?? null,
        fire_at: fireAt,
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
    const when = new Date(fireAt).toLocaleString("en-US", {
      timeZone: "America/New_York",
      dateStyle: "medium",
      timeStyle: "short",
    });

    return {
      ok: true,
      summary: `Created ${recurrence} reminder "${data.title}" for ${when}. Channels: ${input.channels.join(", ")}.`,
      data: { reminder_id: data.id },
    };
  },
};

/**
 * Returns ISO 8601 for "next 6:20 AM in America/New_York". If we're already
 * past 6:20 today, rolls to tomorrow. Used when the LLM doesn't give us a
 * specific fire_at — better than NULL (which the cron would never fire).
 */
function defaultFireAt(): string {
  const tz = "America/New_York";
  const now = new Date();

  // Get today's date in tz to construct 6:20 AM in that local day.
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  // Probe noon UTC of `ymd`, derive its hour-in-tz, walk back to tz midnight.
  const probe = new Date(`${ymd}T12:00:00Z`);
  const tzHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).format(probe),
    10
  );
  const tzMidnight = new Date(probe.getTime() - tzHour * 3_600_000);
  let target = new Date(tzMidnight.getTime() + 6 * 3_600_000 + 20 * 60_000);

  // If 6:20 has already passed today, push to tomorrow
  if (target.getTime() <= now.getTime()) {
    target = new Date(target.getTime() + 24 * 3_600_000);
  }
  return target.toISOString();
}

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
// update_reminder — ack done or snooze (called when user replies to a fired reminder)
// ============================================================================
const UpdateReminderInput = z.object({
  action: z.enum(["complete", "snooze"]),
  reminder_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Specific reminder UUID. Omit to default to the most recently fired unacked reminder."
    ),
  snooze_minutes: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Required when action is 'snooze'. 60 = 1 hour, 1440 = tomorrow (24h), 30 = 30 min, etc."
    ),
});

const updateReminder: ToolDefinition = {
  schema: {
    name: "update_reminder",
    description:
      "Acknowledge a fired reminder. Use when the user replies 'done', 'completed', 'did it', '1h', 'in an hour', 'tomorrow', etc. — typically right after receiving a reminder. Defaults to the most recently fired unacked reminder if no ID given.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["complete", "snooze"],
          description: "'complete' to mark done, 'snooze' to push to a later time",
        },
        reminder_id: {
          type: "string",
          description: "Specific reminder UUID. Omit for the most recent unacked.",
        },
        snooze_minutes: {
          type: "number",
          description:
            "Required for snooze. Common: 30 (30min), 60 (1h), 120 (2h), 1440 (tomorrow same time).",
        },
      },
      required: ["action"],
    },
  },
  async execute(rawInput, ctx) {
    const parsed = UpdateReminderInput.safeParse(rawInput);
    if (!parsed.success) {
      return { ok: false, summary: `Invalid input: ${parsed.error.message}` };
    }
    const input = parsed.data;

    // Resolve reminder_id — default to most recently fired unacked
    let reminderId = input.reminder_id;
    if (!reminderId) {
      const { data } = await ctx.supabase
        .from("reminders")
        .select("id, title, last_fired_at, acked_at")
        .eq("user_id", ctx.userId)
        .not("last_fired_at", "is", null)
        .order("last_fired_at", { ascending: false })
        .limit(5);

      const unacked = (data ?? []).find((r) => {
        if (!r.last_fired_at) return false;
        if (!r.acked_at) return true;
        return new Date(r.acked_at) < new Date(r.last_fired_at);
      });

      if (!unacked) {
        return {
          ok: false,
          summary: "No recently fired reminder to update.",
        };
      }
      reminderId = unacked.id;
    }

    // Fetch the reminder to know if it's recurring + capture title for response
    const { data: reminder, error: fetchErr } = await ctx.supabase
      .from("reminders")
      .select("id, title, rrule, status")
      .eq("id", reminderId)
      .eq("user_id", ctx.userId)
      .single();

    if (fetchErr || !reminder) {
      return { ok: false, summary: `Reminder not found: ${fetchErr?.message ?? "no match"}` };
    }

    const now = new Date();

    if (input.action === "complete") {
      const updates: Record<string, unknown> = {
        acked_at: now.toISOString(),
        updated_at: now.toISOString(),
      };
      // Non-recurring → mark fully completed so cron stops firing it
      if (!reminder.rrule) {
        updates.status = "completed";
      }

      const { error } = await ctx.supabase
        .from("reminders")
        .update(updates)
        .eq("id", reminderId)
        .eq("user_id", ctx.userId);
      if (error) return { ok: false, summary: `DB error: ${error.message}` };

      return {
        ok: true,
        summary: reminder.rrule
          ? `Acked "${reminder.title}" — recurring schedule continues.`
          : `Marked "${reminder.title}" complete.`,
        data: { reminder_id: reminderId, action: "complete" },
      };
    }

    // SNOOZE
    const minutes = input.snooze_minutes ?? 60;
    const newFireAt = new Date(now.getTime() + minutes * 60 * 1000);

    const { error } = await ctx.supabase
      .from("reminders")
      .update({
        fire_at: newFireAt.toISOString(),
        acked_at: now.toISOString(),
        status: "active",
        updated_at: now.toISOString(),
      })
      .eq("id", reminderId)
      .eq("user_id", ctx.userId);
    if (error) return { ok: false, summary: `DB error: ${error.message}` };

    const friendlyTime = newFireAt.toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
    return {
      ok: true,
      summary: `Snoozed "${reminder.title}" → ${friendlyTime}.`,
      data: { reminder_id: reminderId, action: "snooze", new_fire_at: newFireAt.toISOString() },
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
// update_task — change status, board, priority, title, flagged
// ============================================================================
const UpdateTaskInput = z.object({
  task_id: z.string().uuid().optional(),
  query: z
    .string()
    .optional()
    .describe("Fuzzy-match a task by title if no task_id given. Required if task_id missing."),
  status: z
    .enum(["queue", "this_week", "today", "in_progress", "done"])
    .optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  board_name: z.string().optional(),
  flagged: z.boolean().optional(),
  title: z.string().optional(),
});

const updateTask: ToolDefinition = {
  schema: {
    name: "update_task",
    description:
      "Update a task — mark done, change priority, move to a different board, rename, or toggle flagged. Find by task_id or fuzzy-match title via query.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        query: { type: "string", description: "Title fragment if you don't have an ID" },
        status: { type: "string", enum: ["queue", "this_week", "today", "in_progress", "done"] },
        priority: { type: "string", enum: ["high", "medium", "low"] },
        board_name: { type: "string", description: "Move to this board (fuzzy match)" },
        flagged: { type: "boolean" },
        title: { type: "string", description: "Rename the task" },
      },
    },
  },
  async execute(rawInput, ctx) {
    const parsed = UpdateTaskInput.safeParse(rawInput);
    if (!parsed.success) return { ok: false, summary: `Invalid input: ${parsed.error.message}` };
    const input = parsed.data;

    const taskId = await resolveTaskId(input.task_id, input.query, ctx);
    if (!taskId.ok) return taskId;

    const updates: Record<string, unknown> = {
      last_touched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (input.status !== undefined) {
      updates.status = input.status;
      if (input.status === "done") {
        updates.completed_at = new Date().toISOString();
        updates.flagged = false;
      }
    }
    if (input.priority !== undefined) updates.priority = input.priority;
    if (input.flagged !== undefined) {
      updates.flagged = input.flagged;
      if (input.flagged) updates.flagged_at = new Date().toISOString();
    }
    if (input.title !== undefined) updates.title = input.title;

    if (input.board_name !== undefined) {
      const boardId = await resolveBoardId(input.board_name, ctx);
      if (boardId) updates.board_id = boardId;
    }

    const { data, error } = await ctx.supabase
      .from("tasks")
      .update(updates)
      .eq("id", taskId.id)
      .eq("user_id", ctx.userId)
      .select("title, status, priority")
      .single();

    if (error) return { ok: false, summary: `DB error: ${error.message}` };

    return {
      ok: true,
      summary: `Updated task "${data.title}" (status: ${data.status}, priority: ${data.priority}).`,
      data: { task_id: taskId.id },
    };
  },
};

async function resolveTaskId(
  taskId: string | undefined,
  query: string | undefined,
  ctx: ToolContext
): Promise<{ ok: true; id: string } | { ok: false; summary: string }> {
  if (taskId) return { ok: true, id: taskId };
  if (!query) return { ok: false, summary: "Provide either task_id or query." };

  const { data } = await ctx.supabase
    .from("tasks")
    .select("id, title")
    .eq("user_id", ctx.userId)
    .neq("status", "done")
    .ilike("title", `%${query}%`)
    .limit(5);

  if (!data || data.length === 0) return { ok: false, summary: `No active task matches "${query}".` };
  if (data.length > 1) {
    const titles = data.map((t) => `"${t.title}"`).join(", ");
    return {
      ok: false,
      summary: `Multiple tasks match "${query}": ${titles}. Be more specific.`,
    };
  }
  return { ok: true, id: data[0].id };
}

async function resolveBoardId(name: string, ctx: ToolContext): Promise<string | null> {
  const { data } = await ctx.supabase
    .from("boards")
    .select("id, name")
    .eq("user_id", ctx.userId);

  if (!data) return null;
  const target = name.toLowerCase();
  const exact = data.find((b) => b.name.toLowerCase() === target);
  if (exact) return exact.id;
  const partial = data.find(
    (b) => b.name.toLowerCase().includes(target) || target.includes(b.name.toLowerCase())
  );
  return partial?.id ?? null;
}

// ============================================================================
// update_event — reschedule, rename, change details of a calendar event
// ============================================================================
const UpdateEventInput = z.object({
  event_id: z.string().uuid().optional(),
  query: z.string().optional().describe("Fuzzy-match by title if no event_id given"),
  starts_at: z.string().optional().describe("New ISO 8601 start datetime"),
  ends_at: z.string().optional().describe("New ISO 8601 end datetime"),
  title: z.string().optional(),
  description: z.string().optional(),
  all_day: z.boolean().optional(),
});

const updateEvent: ToolDefinition = {
  schema: {
    name: "update_event",
    description:
      "Update a calendar event — reschedule, rename, change duration. Find by event_id or fuzzy-match title via query.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
        query: { type: "string", description: "Title fragment if no ID" },
        starts_at: { type: "string", description: "ISO 8601 datetime" },
        ends_at: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        all_day: { type: "boolean" },
      },
    },
  },
  async execute(rawInput, ctx) {
    const parsed = UpdateEventInput.safeParse(rawInput);
    if (!parsed.success) return { ok: false, summary: `Invalid input: ${parsed.error.message}` };
    const input = parsed.data;

    const eventId = await resolveEventId(input.event_id, input.query, ctx);
    if (!eventId.ok) return eventId;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.starts_at !== undefined) updates.starts_at = input.starts_at;
    if (input.ends_at !== undefined) updates.ends_at = input.ends_at;
    if (input.title !== undefined) updates.title = input.title;
    if (input.description !== undefined) updates.description = input.description;
    if (input.all_day !== undefined) updates.all_day = input.all_day;

    const { data, error } = await ctx.supabase
      .from("calendar_events")
      .update(updates)
      .eq("id", eventId.id)
      .eq("user_id", ctx.userId)
      .select("title, starts_at")
      .single();

    if (error) return { ok: false, summary: `DB error: ${error.message}` };

    const when = new Date(data.starts_at).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
    return { ok: true, summary: `Updated "${data.title}" → ${when}.` };
  },
};

async function resolveEventId(
  eventId: string | undefined,
  query: string | undefined,
  ctx: ToolContext
): Promise<{ ok: true; id: string } | { ok: false; summary: string }> {
  if (eventId) return { ok: true, id: eventId };
  if (!query) return { ok: false, summary: "Provide event_id or query." };

  const now = new Date();
  // Look at upcoming events first (next 30 days)
  const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await ctx.supabase
    .from("calendar_events")
    .select("id, title")
    .eq("user_id", ctx.userId)
    .gte("starts_at", now.toISOString())
    .lte("starts_at", future)
    .ilike("title", `%${query}%`)
    .limit(5);

  if (!data || data.length === 0) return { ok: false, summary: `No upcoming event matches "${query}".` };
  if (data.length > 1) {
    return {
      ok: false,
      summary: `Multiple events match: ${data.map((e) => `"${e.title}"`).join(", ")}. Be more specific.`,
    };
  }
  return { ok: true, id: data[0].id };
}

// ============================================================================
// complete_list_item — check off a list item
// ============================================================================
const CompleteListItemInput = z.object({
  list_name: z
    .string()
    .describe("Which list to look in (e.g. 'Shopping'). Falls back to checking all lists."),
  text: z.string().describe("The item text or fragment to match (e.g. 'milk', 'bread')."),
  uncheck: z.boolean().default(false).describe("Set true to uncheck instead of complete."),
});

const completeListItem: ToolDefinition = {
  schema: {
    name: "complete_list_item",
    description:
      "Check off (or uncheck) an item on a list. Use when the user says 'I bought milk', 'cross off bread', 'done with eggs', etc.",
    input_schema: {
      type: "object",
      properties: {
        list_name: { type: "string", description: "Which list (fuzzy match). Optional if item is unique." },
        text: { type: "string", description: "Item text fragment to match" },
        uncheck: { type: "boolean", description: "Default false. Set true to mark as not-done." },
      },
      required: ["list_name", "text"],
    },
  },
  async execute(rawInput, ctx) {
    const parsed = CompleteListItemInput.safeParse(rawInput);
    if (!parsed.success) return { ok: false, summary: `Invalid input: ${parsed.error.message}` };
    const input = parsed.data;

    // Find the list (fuzzy)
    const { data: lists } = await ctx.supabase
      .from("lists")
      .select("id, name")
      .eq("user_id", ctx.userId)
      .ilike("name", `%${input.list_name}%`)
      .limit(3);

    if (!lists || lists.length === 0) {
      return { ok: false, summary: `No list matches "${input.list_name}".` };
    }
    if (lists.length > 1) {
      return {
        ok: false,
        summary: `Multiple lists match "${input.list_name}": ${lists.map((l) => l.name).join(", ")}. Be more specific.`,
      };
    }
    const listId = lists[0].id;

    // Find the item
    const { data: items } = await ctx.supabase
      .from("list_items")
      .select("id, text, completed")
      .eq("list_id", listId)
      .eq("user_id", ctx.userId)
      .ilike("text", `%${input.text}%`)
      .limit(5);

    if (!items || items.length === 0) {
      return { ok: false, summary: `No item matches "${input.text}" in ${lists[0].name}.` };
    }
    if (items.length > 1) {
      return {
        ok: false,
        summary: `Multiple items match: ${items.map((i) => `"${i.text}"`).join(", ")}. Be more specific.`,
      };
    }

    const item = items[0];
    const completed = !input.uncheck;
    const { error } = await ctx.supabase
      .from("list_items")
      .update({
        completed,
        completed_at: completed ? new Date().toISOString() : null,
      })
      .eq("id", item.id)
      .eq("user_id", ctx.userId);

    if (error) return { ok: false, summary: `DB error: ${error.message}` };

    return {
      ok: true,
      summary: completed
        ? `✓ Crossed off "${item.text}" from ${lists[0].name}.`
        : `Unchecked "${item.text}" on ${lists[0].name}.`,
    };
  },
};

// ============================================================================
// delete_* tools (reminder, task, list, list_item, event)
// ============================================================================
const DeleteInput = z.object({
  id: z.string().uuid().optional(),
  query: z.string().optional().describe("Fuzzy-match by title/text"),
});

function makeDeleter(
  name: string,
  table: string,
  titleField: string,
  description: string
): ToolDefinition {
  return {
    schema: {
      name,
      description,
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          query: { type: "string", description: `Fuzzy match on ${titleField}` },
        },
      },
    },
    async execute(rawInput, ctx) {
      const parsed = DeleteInput.safeParse(rawInput);
      if (!parsed.success) return { ok: false, summary: `Invalid input: ${parsed.error.message}` };
      const input = parsed.data;

      let id = input.id;
      let label = "(unknown)";

      if (!id) {
        if (!input.query) return { ok: false, summary: "Provide id or query." };
        const { data } = await ctx.supabase
          .from(table)
          .select(`id, ${titleField}`)
          .eq("user_id", ctx.userId)
          .ilike(titleField, `%${input.query}%`)
          .limit(5);
        if (!data || data.length === 0) {
          return { ok: false, summary: `No match for "${input.query}".` };
        }
        if (data.length > 1) {
          const labels = data
            .map((row) => `"${(row as unknown as Record<string, string>)[titleField]}"`)
            .join(", ");
          return {
            ok: false,
            summary: `Multiple matches: ${labels}. Be more specific.`,
          };
        }
        id = (data[0] as unknown as Record<string, string>).id;
        label = (data[0] as unknown as Record<string, string>)[titleField];
      }

      const { error } = await ctx.supabase
        .from(table)
        .delete()
        .eq("id", id)
        .eq("user_id", ctx.userId);

      if (error) return { ok: false, summary: `DB error: ${error.message}` };
      return { ok: true, summary: `Deleted ${name.replace("delete_", "")}: "${label}".` };
    },
  };
}

const deleteReminder = makeDeleter(
  "delete_reminder",
  "reminders",
  "title",
  "Delete a reminder. Find by id or fuzzy-match title via query."
);
const deleteTaskTool = makeDeleter(
  "delete_task",
  "tasks",
  "title",
  "Delete a task. Find by id or fuzzy-match title via query."
);
const deleteList = makeDeleter(
  "delete_list",
  "lists",
  "name",
  "Delete a list (and all its items). Find by id or fuzzy-match name."
);
const deleteEvent = makeDeleter(
  "delete_event",
  "calendar_events",
  "title",
  "Delete a calendar event. Find by id or fuzzy-match title via query."
);

// ============================================================================
// query_metric — answer questions about your data
// ============================================================================
const QueryMetricInput = z.object({
  metric: z.enum([
    "todays_tasks",
    "pending_reminders",
    "recurring_reminders",
    "flagged_items",
    "active_lists",
    "todays_events",
    "this_week_events",
    "recent_captures",
    "memories_count",
    // Phases 3-5 will add these:
    "revenue_ytd",
    "close_rate",
    "cash_runway",
    "net_worth",
    "sleep_avg_7d",
    "gym_streak",
  ]),
});

const queryMetric: ToolDefinition = {
  schema: {
    name: "query_metric",
    description:
      "Look up a current metric value. Use when the user asks 'what's my X?' (e.g. 'how many tasks today?', 'what's pending?'). Some metrics (revenue, close rate, cash runway, sleep avg) require Phases 3-5 integrations and will return 'not connected yet'.",
    input_schema: {
      type: "object",
      properties: {
        metric: {
          type: "string",
          enum: [
            "todays_tasks",
            "pending_reminders",
            "recurring_reminders",
            "flagged_items",
            "active_lists",
            "todays_events",
            "this_week_events",
            "recent_captures",
            "memories_count",
            "revenue_ytd",
            "close_rate",
            "cash_runway",
            "net_worth",
            "sleep_avg_7d",
            "gym_streak",
          ],
        },
      },
      required: ["metric"],
    },
  },
  async execute(rawInput, ctx) {
    const parsed = QueryMetricInput.safeParse(rawInput);
    if (!parsed.success) return { ok: false, summary: `Invalid input: ${parsed.error.message}` };
    const m = parsed.data.metric;

    // Phases 3-5 placeholders
    if (
      m === "revenue_ytd" ||
      m === "close_rate" ||
      m === "cash_runway" ||
      m === "net_worth" ||
      m === "sleep_avg_7d" ||
      m === "gym_streak"
    ) {
      const phase =
        m === "revenue_ytd" || m === "close_rate"
          ? "Phase 3 (Business / GoHighLevel)"
          : m === "cash_runway" || m === "net_worth"
          ? "Phase 4 (Finance / Plaid)"
          : "Phase 5 (Health / Apple Health)";
      return {
        ok: true,
        summary: `${m} not connected yet — needs ${phase}.`,
        data: { metric: m, value: null, status: "not_connected" },
      };
    }

    // Real queries on current data
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
    const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    if (m === "todays_tasks") {
      const { count } = await ctx.supabase
        .from("tasks")
        .select("*", { count: "exact", head: true })
        .eq("user_id", ctx.userId)
        .eq("status", "today");
      return { ok: true, summary: `${count ?? 0} task${count === 1 ? "" : "s"} marked Today.` };
    }
    if (m === "pending_reminders") {
      const { count } = await ctx.supabase
        .from("reminders")
        .select("*", { count: "exact", head: true })
        .eq("user_id", ctx.userId)
        .eq("status", "active");
      return { ok: true, summary: `${count ?? 0} active reminder${count === 1 ? "" : "s"}.` };
    }
    if (m === "recurring_reminders") {
      const { count } = await ctx.supabase
        .from("reminders")
        .select("*", { count: "exact", head: true })
        .eq("user_id", ctx.userId)
        .eq("status", "active")
        .not("rrule", "is", null);
      return { ok: true, summary: `${count ?? 0} recurring reminder${count === 1 ? "" : "s"}.` };
    }
    if (m === "flagged_items") {
      const [{ count: flaggedTasks }, { count: flaggedAvoidance }] = await Promise.all([
        ctx.supabase
          .from("tasks")
          .select("*", { count: "exact", head: true })
          .eq("user_id", ctx.userId)
          .eq("flagged", true),
        ctx.supabase
          .from("avoidance_items")
          .select("*", { count: "exact", head: true })
          .eq("user_id", ctx.userId)
          .eq("flagged", true)
          .eq("completed", false),
      ]);
      const total = (flaggedTasks ?? 0) + (flaggedAvoidance ?? 0);
      return {
        ok: true,
        summary: `${total} flagged item${total === 1 ? "" : "s"} (${flaggedTasks ?? 0} task${flaggedTasks === 1 ? "" : "s"} + ${flaggedAvoidance ?? 0} avoidance).`,
      };
    }
    if (m === "active_lists") {
      const { count } = await ctx.supabase
        .from("lists")
        .select("*", { count: "exact", head: true })
        .eq("user_id", ctx.userId)
        .eq("archived", false);
      return { ok: true, summary: `${count ?? 0} active list${count === 1 ? "" : "s"}.` };
    }
    if (m === "todays_events") {
      const { data } = await ctx.supabase
        .from("calendar_events")
        .select("title, starts_at")
        .eq("user_id", ctx.userId)
        .gte("starts_at", startOfToday.toISOString())
        .lt("starts_at", endOfToday.toISOString())
        .order("starts_at");
      const events = data ?? [];
      const summary =
        events.length === 0
          ? "No events today."
          : `${events.length} event${events.length === 1 ? "" : "s"} today: ${events
              .map((e) => `${e.title} (${new Date(e.starts_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })})`)
              .join(", ")}.`;
      return { ok: true, summary };
    }
    if (m === "this_week_events") {
      const { count } = await ctx.supabase
        .from("calendar_events")
        .select("*", { count: "exact", head: true })
        .eq("user_id", ctx.userId)
        .gte("starts_at", now.toISOString())
        .lt("starts_at", inSevenDays.toISOString());
      return { ok: true, summary: `${count ?? 0} event${count === 1 ? "" : "s"} in the next 7 days.` };
    }
    if (m === "recent_captures") {
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const { count } = await ctx.supabase
        .from("captures")
        .select("*", { count: "exact", head: true })
        .eq("user_id", ctx.userId)
        .gte("created_at", yesterday.toISOString());
      return { ok: true, summary: `${count ?? 0} capture${count === 1 ? "" : "s"} in the last 24h.` };
    }
    if (m === "memories_count") {
      const { count } = await ctx.supabase
        .from("memories")
        .select("*", { count: "exact", head: true })
        .eq("user_id", ctx.userId)
        .eq("active", true);
      return { ok: true, summary: `${count ?? 0} long-term memor${count === 1 ? "y" : "ies"} stored.` };
    }

    return { ok: false, summary: "Unknown metric." };
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
  update_reminder: updateReminder,
  update_task: updateTask,
  update_event: updateEvent,
  complete_list_item: completeListItem,
  delete_reminder: deleteReminder,
  delete_task: deleteTaskTool,
  delete_list: deleteList,
  delete_event: deleteEvent,
  query_metric: queryMetric,
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
