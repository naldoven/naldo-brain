/**
 * POST /api/inbox/drafts/[id]/dismiss
 *
 * "I'll handle this in Gmail." Removes the queued item from the dashboard
 * but takes no action on Gmail (the email stays in the inbox; if a draft
 * was created, it stays in Drafts for Naldo to use or discard manually).
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
    .from("email_messages")
    .update({ status: "dismissed", user_action_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
