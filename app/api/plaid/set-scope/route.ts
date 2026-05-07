/**
 * Toggle a Plaid item's scope between 'personal' and 'business'.
 * Cookie-authed; only updates the calling user's own items via RLS.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const bodySchema = z.object({
  item_id: z.string().uuid(),
  scope: z.enum(["personal", "business"]),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "bad_body";
    return NextResponse.json({ error: "bad_request", detail: msg }, { status: 400 });
  }

  // RLS scoping ensures we can only flip our own items.
  const { error } = await supabase
    .from("plaid_items")
    .update({ scope: parsed.scope, updated_at: new Date().toISOString() })
    .eq("id", parsed.item_id)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: "update_failed", detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, scope: parsed.scope });
}
