/**
 * Labels CRUD (collection-level).
 *
 * GET  /api/inbox/labels?account_id=...   List labels (RLS scopes by user)
 * POST /api/inbox/labels                  Create a label + sync to Gmail
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createOrFindGmailLabel,
  getGmailForAccount,
} from "@/lib/inbox/gmail";
import type {
  DefaultAction,
  EmailAccountRow,
  EmailLabelRow,
} from "@/lib/inbox/types";

export const runtime = "nodejs";

const VALID_ACTIONS: DefaultAction[] = [
  "archive_only",
  "keep_in_inbox",
  "surface_no_draft",
  "surface_with_draft",
  "trash_only",
  "archive_after_24h",
  "trash_after_24h",
];

export async function GET(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const accountId = url.searchParams.get("account_id");
  let q = supabase
    .from("email_labels")
    .select("*")
    .order("sort_order", { ascending: true });
  if (accountId) q = q.eq("account_id", accountId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ labels: data });
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
        name?: string;
        description?: string;
        default_action?: string;
        sort_order?: number;
      }
    | null;
  if (!body || !body.account_id || !body.name || !body.default_action) {
    return NextResponse.json(
      { error: "account_id, name, and default_action are required" },
      { status: 400 },
    );
  }
  if (!VALID_ACTIONS.includes(body.default_action as DefaultAction)) {
    return NextResponse.json(
      { error: `default_action must be one of: ${VALID_ACTIONS.join(", ")}` },
      { status: 400 },
    );
  }

  // Look up the account so we can sync to Gmail
  const { data: acc, error: accErr } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("id", body.account_id)
    .single();
  if (accErr || !acc) return NextResponse.json({ error: "account not found" }, { status: 404 });
  const account = acc as EmailAccountRow;

  let gmailLabelId: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gmail = await getGmailForAccount(supabase as any, account);
    gmailLabelId = await createOrFindGmailLabel(gmail, body.name);
  } catch (err) {
    console.error("[labels] Gmail label creation failed:", (err as Error).message);
    return NextResponse.json(
      { error: `Failed to create Gmail label: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  const { data: created, error: insertErr } = await supabase
    .from("email_labels")
    .insert({
      user_id: user.id,
      account_id: body.account_id,
      name: body.name,
      description: body.description ?? "",
      gmail_label_id: gmailLabelId,
      default_action: body.default_action,
      sort_order: body.sort_order ?? 0,
    })
    .select()
    .single();
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }
  return NextResponse.json({ label: created as EmailLabelRow });
}
