/**
 * POST /api/inbox/drafts/[id]/edit
 *
 * Update the body of a Gmail draft and the email_messages row.
 * Body: { draft_subject?: string, draft_body: string }
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGmailForAccount, updateDraftBody } from "@/lib/inbox/gmail";
import type { EmailAccountRow, EmailMessageRow } from "@/lib/inbox/types";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as
    | { draft_subject?: string; draft_body?: string }
    | null;
  if (!body || typeof body.draft_body !== "string") {
    return NextResponse.json({ error: "draft_body is required" }, { status: 400 });
  }

  const { data: msg, error: msgErr } = await supabase
    .from("email_messages")
    .select("*")
    .eq("id", id)
    .single();
  if (msgErr || !msg) return NextResponse.json({ error: "not found" }, { status: 404 });
  const message = msg as EmailMessageRow;

  if (!message.gmail_draft_id) {
    return NextResponse.json(
      { error: "this message has no Gmail draft to edit" },
      { status: 400 },
    );
  }

  const { data: acc, error: accErr } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("id", message.account_id)
    .single();
  if (accErr || !acc) return NextResponse.json({ error: "account missing" }, { status: 500 });
  const account = acc as EmailAccountRow;

  const newSubject = body.draft_subject ?? message.draft_subject ?? "(no subject)";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gmail = await getGmailForAccount(supabase as any, account);
  await updateDraftBody({
    gmail,
    draftId: message.gmail_draft_id,
    threadId: message.gmail_thread_id,
    to: message.from_address,
    subject: newSubject,
    bodyText: body.draft_body,
  });

  await supabase
    .from("email_messages")
    .update({
      draft_subject: newSubject,
      draft_body: body.draft_body,
      user_action_at: new Date().toISOString(),
    })
    .eq("id", id);

  return NextResponse.json({ ok: true });
}
