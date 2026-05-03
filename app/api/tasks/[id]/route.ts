import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const PatchSchema = z.object({
  title: z.string().min(1).max(280).optional(),
  description: z.string().nullable().optional(),
  status: z
    .enum(["queue", "this_week", "today", "in_progress", "done"])
    .optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  board_id: z.string().uuid().nullable().optional(),
  flagged: z.boolean().optional(),
  time_estimate: z.string().nullable().optional(),
  position: z.number().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }

  const update: Record<string, unknown> = {
    ...parsed.data,
    last_touched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.status === "done" && !("completed_at" in update)) {
    update.completed_at = new Date().toISOString();
    update.flagged = false;
  }

  const { data, error } = await supabase
    .from("tasks")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const { error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
