import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const CreateSchema = z.object({
  title: z.string().min(1).max(280),
  description: z.string().max(2000).optional().nullable(),
  board_id: z.string().uuid().optional().nullable(),
  status: z
    .enum(["queue", "this_week", "today", "in_progress", "done"])
    .default("queue"),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  time_estimate: z.string().max(20).optional().nullable(),
  due_at: z.string().datetime().optional().nullable(),
});

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const boardId = request.nextUrl.searchParams.get("board_id");

  let query = supabase
    .from("tasks")
    .select("*")
    .eq("user_id", user.id)
    .order("position", { ascending: true });

  if (boardId) query = query.eq("board_id", boardId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid input", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: user.id,
      board_id: parsed.data.board_id ?? null,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      status: parsed.data.status,
      priority: parsed.data.priority,
      time_estimate: parsed.data.time_estimate ?? null,
      due_at: parsed.data.due_at ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}
