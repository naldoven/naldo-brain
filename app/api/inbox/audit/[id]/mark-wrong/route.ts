/**
 * POST /api/inbox/audit/[id]/mark-wrong
 *
 * Flag an archive decision as wrong. Doesn't change Gmail state — just
 * records that the agent got this one wrong, so we can review patterns
 * later and tune the rubric.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const { error } = await supabase
    .from("email_archive_audit")
    .update({ marked_wrong_at: new Date().toISOString() })
    .eq("message_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
