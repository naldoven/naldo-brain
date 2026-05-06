/**
 * POST /api/inbox/drafts/[id]/trash
 *
 * Move the original incoming email to Gmail Trash. Reversible from Gmail
 * Trash for 30 days, then auto-purged.
 *
 * Also deletes any draft that was attached to this message (no point keeping
 * a draft for a trashed email).
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteDraft, getGmailForAccount, trashMessage } from "@/lib/inbox/gmail";
import type { EmailAccountRow, EmailMessageRow } from "@/lib/inbox/types";

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

  const { data: msg, error: msgErr } = await supabase
    .from("email_messages")
    .select("*")
    .eq("id", id)
    .single();
  if (msgErr || !msg) return NextResponse.json({ error: "not found" }, { status: 404 });
  const message = msg as EmailMessageRow;

  const { data: acc, error: accErr } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("id", message.account_id)
    .single();
  if (accErr || !acc) return NextResponse.json({ error: "account missing" }, { status: 500 });
  const account = acc as EmailAccountRow;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gmail = await getGmailForAccount(supabase as any, account);

  try {
    await trashMessage(gmail, message.gmail_message_id);
  } catch (err) {
    return NextResponse.json(
      { error: `Gmail trash failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  if (message.gmail_draft_id) {
    try {
      await deleteDraft(gmail, message.gmail_draft_id);
    } catch {
      // ignore — orphan drafts get cleaned up by Gmail
    }
  }

  await supabase
    .from("email_messages")
    .update({
      status: "dismissed",
      gmail_draft_id: null,
      user_action_at: new Date().toISOString(),
    })
    .eq("id", id);

  return NextResponse.json({ ok: true });
}
