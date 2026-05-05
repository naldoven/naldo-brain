/**
 * POST /api/inbox/drafts/[id]/unsubscribe-trash
 *
 * The "Trash + block sender" button. One-click cleanup of an unwanted sender:
 *
 *   1. If the email has a List-Unsubscribe header, attempt to unsubscribe
 *      (one-click POST per RFC 8058, or mailto: as fallback).
 *   2. Trash this email in Gmail (auto-deletes after 30 days).
 *   3. Create a permanent email_sender_rules row with action='trash' so future
 *      emails from this domain go straight to Trash without spending an
 *      Anthropic API call.
 *
 * Returns the unsubscribe outcome so the UI can tell the user what happened.
 * If only a manual_url was available, the UI surfaces it.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  deleteDraft,
  getGmailForAccount,
  getMessageDetails,
  trashMessage,
  unsubscribeFromMessage,
} from "@/lib/inbox/gmail";
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

  // Step 1: Try unsubscribe via the email's headers
  let unsubscribeResult: Awaited<ReturnType<typeof unsubscribeFromMessage>> = {
    method: "none",
    ok: false,
  };
  try {
    const fresh = await getMessageDetails(gmail, message.gmail_message_id);
    unsubscribeResult = await unsubscribeFromMessage(gmail, fresh.headers);
  } catch (err) {
    console.warn(
      "[unsubscribe-trash] header fetch / unsubscribe failed:",
      (err as Error).message,
    );
  }

  // Step 2: Trash the original message
  try {
    await trashMessage(gmail, message.gmail_message_id);
  } catch (err) {
    return NextResponse.json(
      { error: `Gmail trash failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  // Step 3: Clean up draft
  if (message.gmail_draft_id) {
    try {
      await deleteDraft(gmail, message.gmail_draft_id);
    } catch {
      // ignore
    }
  }

  // Step 4: Create a permanent domain-level sender rule (idempotent)
  const fromDomain = message.from_address.split("@")[1]?.toLowerCase() || "";
  if (fromDomain) {
    await supabase.from("email_sender_rules").upsert(
      {
        user_id: user.id,
        account_id: account.id,
        sender_pattern: fromDomain,
        pattern_type: "domain",
        action: "trash",
        reason: `auto-added from "${message.subject || "(no subject)"}" — unsubscribe attempt: ${unsubscribeResult.method}`,
      },
      { onConflict: "account_id,sender_pattern,pattern_type" },
    );
  }

  await supabase
    .from("email_messages")
    .update({
      status: "dismissed",
      gmail_draft_id: null,
      user_action_at: new Date().toISOString(),
    })
    .eq("id", id);

  return NextResponse.json({
    ok: true,
    unsubscribe: unsubscribeResult,
    rule_domain: fromDomain,
  });
}
