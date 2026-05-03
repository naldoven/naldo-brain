import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(["shopping", "todo", "project", "habit", "goal", "custom"]).default("custom"),
  emoji: z.string().max(4).optional().nullable(),
  color: z.string().max(20).optional().nullable(),
});

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("lists")
    .select(`
      *,
      list_items (id, text, completed, position, created_at)
    `)
    .eq("user_id", user.id)
    .eq("archived", false)
    .order("position");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lists: data ?? [] });
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
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }

  const { count } = await supabase
    .from("lists")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  const { data, error } = await supabase
    .from("lists")
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      type: parsed.data.type,
      emoji: parsed.data.emoji ?? emojiForType(parsed.data.type),
      color: parsed.data.color ?? "#6366F1",
      position: count ?? 0,
    })
    .select(`*, list_items (id, text, completed, position, created_at)`)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ list: data });
}

function emojiForType(type: string): string {
  switch (type) {
    case "shopping":
      return "🛒";
    case "todo":
      return "✅";
    case "project":
      return "🏗️";
    case "habit":
      return "💪";
    case "goal":
      return "🎯";
    default:
      return "📋";
  }
}
