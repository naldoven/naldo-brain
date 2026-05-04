import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { pushUpdate, pushDelete } from "@/lib/google-calendar";

const PatchSchema = z.object({
  title: z.string().min(1).max(280).optional(),
  description: z.string().nullable().optional(),
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  all_day: z.boolean().optional(),
  color: z.string().nullable().optional(),
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
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });

  const { data, error } = await supabase
    .from("calendar_events")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Push update to Google if event has external_id (was originally synced)
  try {
    await pushUpdate(supabase, user.id, data);
  } catch (err) {
    console.warn("[calendar-events] Google push update failed:", err);
  }

  return NextResponse.json({ event: data });
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

  // Capture external_id BEFORE deleting locally so we can push delete to Google
  const { data: existing } = await supabase
    .from("calendar_events")
    .select("external_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  const { error } = await supabase
    .from("calendar_events")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (existing?.external_id) {
    try {
      await pushDelete(supabase, user.id, existing.external_id);
    } catch (err) {
      console.warn("[calendar-events] Google push delete failed:", err);
    }
  }

  return NextResponse.json({ ok: true });
}
