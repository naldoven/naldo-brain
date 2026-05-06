/**
 * POST /api/inbox/audit/[id]/unarchive
 *
 * The most important escape hatch. If the agent wrongly archived something,
 * one click here puts it back in INBOX (Gmail) and updates our records.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGmailForAccount, unarchiveMessage } from "@/lib/inbox/gmail";
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

  const { data: msg } = await supabase
    .from("email_messages")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!msg) return NextResponse.json({ error: "not found" }, { status: 404 });
  const message = msg as EmailMessageRow;

  const { data: acc } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("id", message.account_id)
    .single();
  if (!acc) return NextResponse.json({ error: "account missing" }, { status: 500 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gmail = await getGmailForAccount(supabase as any, acc as EmailAccountRow);
  await unarchiveMessage(gmail, message.gmail_message_id);

  await supabase
    .from("email_messages")
    .update({
      status: "unarchived",
      user_action_at: new Date().toISOString(),
    })
    .eq("id", id);

  await supabase
    .from("email_archive_audit")
    .update({ unarchived_at: new Date().toISOString() })
    .eq("message_id", id);

  return NextResponse.json({ ok: true });
}
