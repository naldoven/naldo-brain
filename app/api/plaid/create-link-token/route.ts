/**
 * Generate a Plaid link_token for the authed user. The frontend opens
 * Plaid Link with this token to start the OAuth flow.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createLinkToken } from "@/lib/plaid";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const linkToken = await createLinkToken(user.id);
    return NextResponse.json({ link_token: linkToken });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "link_token_failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
