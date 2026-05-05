/**
 * POST /api/inbox/drafts/[id]/reject
 *
 * Discard a queued draft. Deletes the Gmail draft AND marks the email_messages
 * row as rejected. The original incoming email stays in INBOX (so Naldo can
 * deal with it manually).
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteDraft, getGmailForAccount } from "@/lib/inbox/gmail";
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

  if (message.gmail_draft_id) {
    const { data: acc } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("id", message.account_id)
      .single();
    if (acc) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gmail = await getGmailForAccount(supabase as any, acc as EmailAccountRow);
        await deleteDraft(gmail, message.gmail_draft_id);
      } catch (err) {
        console.warn(
          `[reject] could not delete draft ${message.gmail_draft_id}:`,
          (err as Error).message,
        );
      }
    }
  }

  await supabase
    .from("email_messages")
    .update({
      status: "rejected",
      gmail_draft_id: null,
      user_action_at: new Date().toISOString(),
    })
    .eq("id", id);

  return NextResponse.json({ ok: true });
}
