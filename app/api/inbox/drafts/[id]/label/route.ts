/**
 * POST /api/inbox/drafts/[id]/label
 *
 * Apply (or change, or remove) the label on a message.
 *
 * Body: { label_id: string | null }
 *   - label_id: a label belonging to the same account → apply that label
 *               (and remove any prior label on the message)
 *   - null     → remove any prior label, leave the message unlabeled
 *
 * In Gmail, this means: removing the previous gmail_label_id (if any) and
 * adding the new one (if any). Side-effects depend on the new label's
 * default_action (archive_only/trash_only also remove the message from INBOX
 * or move it to Trash; *_after_24h variants hide from dashboard for the
 * deferred sweep to pick up later).
 *
 * Also captures the change as an EmailCorrectionRow if the label actually
 * changed — used as few-shot training examples on subsequent Claude calls.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  applyGmailLabel,
  archiveMessage,
  deleteDraft,
  getGmailForAccount,
  removeGmailLabel,
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
    | { label_id?: string | null }
    | null;
  if (!body || body.label_id === undefined) {
    return NextResponse.json(
      { error: "label_id is required (use null to remove the label)" },
      { status: 400 },
    );
  }

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

  let newLabel: EmailLabelRow | null = null;
  if (body.label_id) {
    const { data: lbl } = await supabase
      .from("email_labels")
      .select("*")
      .eq("id", body.label_id)
      .eq("account_id", message.account_id)
      .maybeSingle();
    if (!lbl) {
      return NextResponse.json(
        { error: "label not found or doesn't belong to this account" },
        { status: 400 },
      );
    }
    newLabel = lbl as EmailLabelRow;
  }

  let oldLabel: EmailLabelRow | null = null;
  if (message.label_id) {
    const { data: lbl } = await supabase
      .from("email_labels")
      .select("*")
      .eq("id", message.label_id)
      .maybeSingle();
    if (lbl) oldLabel = lbl as EmailLabelRow;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gmail = await getGmailForAccount(supabase as any, account);

  if (
    oldLabel?.gmail_label_id &&
    oldLabel.id !== newLabel?.id
  ) {
    try {
      await removeGmailLabel(gmail, message.gmail_message_id, oldLabel.gmail_label_id);
    } catch (err) {
      console.warn(
        `[label] could not remove old label ${oldLabel.gmail_label_id}:`,
        (err as Error).message,
      );
    }
  }

  const shouldArchive = newLabel?.default_action === "archive_only";
  const shouldTrash = newLabel?.default_action === "trash_only";
  if (newLabel?.gmail_label_id) {
    try {
      await applyGmailLabel(
        gmail,
        message.gmail_message_id,
        newLabel.gmail_label_id,
        shouldArchive,
      );
    } catch (err) {
      return NextResponse.json(
        { error: `Gmail label apply failed: ${(err as Error).message}` },
        { status: 502 },
      );
    }
  } else if (shouldArchive) {
    await archiveMessage(gmail, message.gmail_message_id);
  }

  if (shouldTrash) {
    try {
      await trashMessage(gmail, message.gmail_message_id);
    } catch (err) {
      return NextResponse.json(
        { error: `Gmail trash failed: ${(err as Error).message}` },
        { status: 502 },
      );
    }
  }

  let newStatus: MessageStatus = "pending";
  let newDraftId: string | null | undefined = undefined;
  if (newLabel) {
    switch (newLabel.default_action) {
      case "archive_only":
      case "trash_only":
        newStatus = "archived";
        if (message.gmail_draft_id) {
          try {
            await deleteDraft(gmail, message.gmail_draft_id);
          } catch {
            // ignore
          }
          newDraftId = null;
        }
        break;
      case "keep_in_inbox":
        newStatus = "dismissed";
        if (message.gmail_draft_id) {
          try {
            await deleteDraft(gmail, message.gmail_draft_id);
          } catch {
            // ignore
          }
          newDraftId = null;
        }
        break;
      case "archive_after_24h":
      case "trash_after_24h":
        newStatus = "dismissed";
        break;
      case "surface_no_draft":
      case "surface_with_draft":
        newStatus = "pending";
        break;
    }
  }

  const updatePayload: Record<string, unknown> = {
    label_id: newLabel?.id ?? null,
    status: newStatus,
    user_action_at: new Date().toISOString(),
  };
  if (newDraftId === null) updatePayload.gmail_draft_id = null;
  await supabase.from("email_messages").update(updatePayload).eq("id", id);

  // Capture training signal if the label actually changed
  const oldLabelId = oldLabel?.id ?? null;
  const newLabelId = newLabel?.id ?? null;
  if (oldLabelId !== newLabelId) {
    await supabase.from("email_corrections").insert({
      user_id: user.id,
      account_id: message.account_id,
      message_id: message.id,
      from_address: message.from_address,
      from_name: message.from_name,
      subject: message.subject,
      snippet: message.snippet,
      original_label_id: oldLabelId,
      original_label_name: oldLabel?.name ?? null,
      corrected_label_id: newLabelId,
      corrected_label_name: newLabel?.name ?? null,
    });
  }

  // If archived (not trashed), write to email_archive_audit so /audit can
  // un-archive it later
  if (newStatus === "archived" && !shouldTrash) {
    await supabase.from("email_archive_audit").upsert({
      message_id: id,
      user_id: user.id,
      archived_at: new Date().toISOString(),
    });
  }

  return NextResponse.json({
    ok: true,
    label_id: newLabel?.id ?? null,
    status: newStatus,
  });
}
