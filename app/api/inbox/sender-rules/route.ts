/**
 * Sender rules CRUD (collection).
 *
 * GET  /api/inbox/sender-rules?account_id=...   List rules
 * POST /api/inbox/sender-rules                  Upsert a rule, optionally also
 *                                               retroactively act on the
 *                                               specific message that
 *                                               prompted it.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { archiveMessage, getGmailForAccount, trashMessage } from "@/lib/inbox/gmail";
import type {
  EmailAccountRow,
  EmailMessageRow,
  EmailSenderRuleRow,
  SenderRuleAction,
  SenderRulePatternType,
} from "@/lib/inbox/types";

export const runtime = "nodejs";

const VALID_ACTIONS: SenderRuleAction[] = [
  "archive",
  "surface",
  "apply_label",
  "trash",
];
const VALID_PATTERN_TYPES: SenderRulePatternType[] = ["exact_email", "domain"];

export async function GET(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const accountId = url.searchParams.get("account_id");
  let q = supabase
    .from("email_sender_rules")
    .select("*")
    .order("created_at", { ascending: false });
  if (accountId) q = q.eq("account_id", accountId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data });
}

export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | {
        account_id?: string;
        sender_pattern?: string;
        pattern_type?: string;
        action?: string;
        apply_label_id?: string | null;
        reason?: string;
        also_archive_message_id?: string;
        also_trash_message_id?: string;
      }
    | null;
  if (
    !body ||
    !body.account_id ||
    !body.sender_pattern ||
    !body.pattern_type ||
    !body.action
  ) {
    return NextResponse.json(
      {
        error:
          "account_id, sender_pattern, pattern_type, and action are required",
      },
      { status: 400 },
    );
  }
  if (!VALID_PATTERN_TYPES.includes(body.pattern_type as SenderRulePatternType)) {
    return NextResponse.json(
      { error: `pattern_type must be one of: ${VALID_PATTERN_TYPES.join(", ")}` },
      { status: 400 },
    );
  }
  if (!VALID_ACTIONS.includes(body.action as SenderRuleAction)) {
    return NextResponse.json(
      { error: `action must be one of: ${VALID_ACTIONS.join(", ")}` },
      { status: 400 },
    );
  }

  const { data: created, error } = await supabase
    .from("email_sender_rules")
    .upsert(
      {
        user_id: user.id,
        account_id: body.account_id,
        sender_pattern: body.sender_pattern.toLowerCase(),
        pattern_type: body.pattern_type,
        action: body.action,
        apply_label_id: body.apply_label_id ?? null,
        reason: body.reason ?? null,
      },
      { onConflict: "account_id,sender_pattern,pattern_type" },
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Optional: retroactively apply to the prompting message
  if (body.also_archive_message_id && body.action === "archive") {
    try {
      await applyArchiveToMessage(supabase, body.also_archive_message_id, user.id);
    } catch (err) {
      console.warn(
        "[sender-rules] retroactive archive failed:",
        (err as Error).message,
      );
    }
  } else if (body.also_trash_message_id && body.action === "trash") {
    try {
      await applyTrashToMessage(supabase, body.also_trash_message_id);
    } catch (err) {
      console.warn(
        "[sender-rules] retroactive trash failed:",
        (err as Error).message,
      );
    }
  }

  return NextResponse.json({ rule: created as EmailSenderRuleRow });
}

async function applyArchiveToMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  messageId: string,
  userId: string,
): Promise<void> {
  const { data: msg } = await supabase
    .from("email_messages")
    .select("*")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg) return;
  const message = msg as EmailMessageRow;
  const { data: acc } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("id", message.account_id)
    .single();
  if (!acc) return;
  const account = acc as EmailAccountRow;
  const gmail = await getGmailForAccount(supabase, account);
  await archiveMessage(gmail, message.gmail_message_id);
  await supabase
    .from("email_messages")
    .update({
      status: "archived",
      action_taken: "archived",
      user_action_at: new Date().toISOString(),
    })
    .eq("id", messageId);
  await supabase.from("email_archive_audit").upsert({
    message_id: messageId,
    user_id: userId,
    archived_at: new Date().toISOString(),
  });
}

async function applyTrashToMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  messageId: string,
): Promise<void> {
  const { data: msg } = await supabase
    .from("email_messages")
    .select("*")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg) return;
  const message = msg as EmailMessageRow;
  const { data: acc } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("id", message.account_id)
    .single();
  if (!acc) return;
  const account = acc as EmailAccountRow;
  const gmail = await getGmailForAccount(supabase, account);
  await trashMessage(gmail, message.gmail_message_id);
  await supabase
    .from("email_messages")
    .update({
      status: "dismissed",
      gmail_draft_id: null,
      user_action_at: new Date().toISOString(),
    })
    .eq("id", messageId);
}
