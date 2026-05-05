/**
 * POST /api/inbox/drafts/[id]/confirm
 *
 * "AI got it right — apply the action now." Used for messages that surfaced
 * to the dashboard because Claude's confidence was below the threshold.
 * If the user agrees with the label, this endpoint applies the label's
 * default_action immediately, the way it would have happened if Claude had
 * been confident enough.
 *
 * Behavior by label.default_action:
 *   archive_only        → archive, status='archived', /audit row
 *   trash_only          → trash, status='archived' (recover via Gmail Trash)
 *   archive_after_24h   → status='dismissed'; deferred sweep archives in 24h
 *   trash_after_24h     → status='dismissed'; deferred sweep trashes in 24h
 *   keep_in_inbox       → status='dismissed'; tagged in Gmail, off dashboard
 *   surface_no_draft    → status='dismissed' (user acknowledged FYI)
 *   surface_with_draft  → status='dismissed' (draft stays in Gmail Drafts)
 *   (no label)          → status='dismissed' (just acknowledge)
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  archiveMessage,
  getGmailForAccount,
  trashMessage,
} from "@/lib/inbox/gmail";
import type {
  EmailAccountRow,
  EmailLabelRow,
  EmailMessageRow,
  MessageStatus,
} from "@/lib/inbox/types";

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

  let label: EmailLabelRow | null = null;
  if (message.label_id) {
    const { data: lbl } = await supabase
      .from("email_labels")
      .select("*")
      .eq("id", message.label_id)
      .maybeSingle();
    if (lbl) label = lbl as EmailLabelRow;
  }

  let newStatus: MessageStatus = "dismissed";
  let needArchive = false;
  let needTrash = false;
  let writeArchiveAudit = false;

  if (label) {
    switch (label.default_action) {
      case "archive_only":
        needArchive = true;
        newStatus = "archived";
        writeArchiveAudit = true;
        break;
      case "trash_only":
        needTrash = true;
        newStatus = "archived";
        break;
      case "archive_after_24h":
      case "trash_after_24h":
      case "keep_in_inbox":
      case "surface_no_draft":
      case "surface_with_draft":
        newStatus = "dismissed";
        break;
    }
  }

  if (needArchive || needTrash) {
    const { data: acc, error: accErr } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("id", message.account_id)
      .single();
    if (accErr || !acc) {
      return NextResponse.json({ error: "account missing" }, { status: 500 });
    }
    const account = acc as EmailAccountRow;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gmail = await getGmailForAccount(supabase as any, account);
    try {
      if (needTrash) {
        await trashMessage(gmail, message.gmail_message_id);
      } else {
        await archiveMessage(gmail, message.gmail_message_id);
      }
    } catch (err) {
      return NextResponse.json(
        { error: `Gmail action failed: ${(err as Error).message}` },
        { status: 502 },
      );
    }
  }

  await supabase
    .from("email_messages")
    .update({
      status: newStatus,
      action_taken: newStatus === "archived" ? "archived" : message.action_taken,
      user_action_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (writeArchiveAudit) {
    await supabase.from("email_archive_audit").upsert({
      message_id: id,
      user_id: user.id,
      archived_at: new Date().toISOString(),
    });
  }

  return NextResponse.json({
    ok: true,
    status: newStatus,
    label_action: label?.default_action ?? null,
  });
}
