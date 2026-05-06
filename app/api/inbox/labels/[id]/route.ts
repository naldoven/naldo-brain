/**
 * Single-label endpoints.
 *
 * PATCH  /api/inbox/labels/[id]   Update name/description/default_action/sort_order
 * DELETE /api/inbox/labels/[id]   Delete the row from our DB. The Gmail label
 *                                 stays in Gmail (we don't auto-delete Gmail
 *                                 labels — the user might be using them outside
 *                                 the agent). email_messages.label_id is set
 *                                 to null via ON DELETE SET NULL FK.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { DefaultAction } from "@/lib/inbox/types";

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

export async function PATCH(
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
    | {
        name?: string;
        description?: string;
        default_action?: string;
        sort_order?: number;
      }
    | null;
  if (!body) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }
  if (
    body.default_action !== undefined &&
    !VALID_ACTIONS.includes(body.default_action as DefaultAction)
  ) {
    return NextResponse.json(
      { error: `default_action must be one of: ${VALID_ACTIONS.join(", ")}` },
      { status: 400 },
    );
  }
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.description !== undefined) update.description = body.description;
  if (body.default_action !== undefined) update.default_action = body.default_action;
  if (body.sort_order !== undefined) update.sort_order = body.sort_order;

  const { error } = await supabase.from("email_labels").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const { error } = await supabase.from("email_labels").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
