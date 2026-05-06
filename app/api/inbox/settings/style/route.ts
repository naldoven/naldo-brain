/**
 * POST /api/inbox/settings/style
 *
 * Upsert the email_style_overrides row for a given account.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | {
        account_id?: string;
        style_guide?: string;
        favorite_emails?: string;
        hard_rules?: string;
      }
    | null;
  if (!body || !body.account_id) {
    return NextResponse.json({ error: "account_id is required" }, { status: 400 });
  }
  const { error } = await supabase.from("email_style_overrides").upsert({
    user_id: user.id,
    account_id: body.account_id,
    style_guide: body.style_guide ?? "",
    favorite_emails: body.favorite_emails ?? "",
    hard_rules: body.hard_rules ?? "",
    updated_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
