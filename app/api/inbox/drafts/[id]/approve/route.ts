/**
 * POST /api/inbox/drafts/[id]/approve
 *
 * Mark a queued draft as "approved" — Naldo intends to send it from his
 * Gmail Drafts folder. This route does NOT call Gmail to send; the agent
 * never sends mail in his name. The draft already exists in Gmail Drafts
 * (created during triage); approving here is a dashboard state change only.
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
    .update({ status: "approved", user_action_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
