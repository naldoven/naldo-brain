import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const CreateSchema = z.object({
  title: z.string().min(1).max(280),
  description: z.string().max(2000).optional().nullable(),
  fire_at: z.string().datetime().optional().nullable(),
  rrule: z.string().max(500).optional().nullable(),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  channels: z.array(z.enum(["whatsapp", "email", "sms", "push"])).default(["whatsapp"]),
  tags: z.array(z.string()).optional().nullable(),
  emoji: z.string().optional().nullable(),
});

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("reminders")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reminders: data ?? [] });
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
    .from("reminders")
    .insert({
      user_id: user.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      fire_at: parsed.data.fire_at ?? null,
      rrule: parsed.data.rrule ?? null,
      priority: parsed.data.priority,
      channels: parsed.data.channels,
      tags: parsed.data.tags ?? null,
      emoji: parsed.data.emoji ?? null,
      status: "active",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reminder: data });
}
