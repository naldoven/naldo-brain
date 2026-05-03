import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const CreateSchema = z.object({
  title: z.string().min(1).max(280),
  description: z.string().max(2000).optional().nullable(),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime().optional().nullable(),
  all_day: z.boolean().default(false),
  rrule: z.string().max(500).optional().nullable(),
  color: z.string().max(20).optional().nullable(),
});

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = request.nextUrl;
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  let query = supabase
    .from("calendar_events")
    .select("*")
    .eq("user_id", user.id)
    .order("starts_at", { ascending: true });

  if (fromParam) query = query.gte("starts_at", fromParam);
  if (toParam) query = query.lte("starts_at", toParam);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ events: data ?? [] });
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
    .from("calendar_events")
    .insert({
      user_id: user.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      starts_at: parsed.data.starts_at,
      ends_at: parsed.data.ends_at ?? null,
      all_day: parsed.data.all_day,
      rrule: parsed.data.rrule ?? null,
      color: parsed.data.color ?? "#6366F1",
      source: "local",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event: data });
}
