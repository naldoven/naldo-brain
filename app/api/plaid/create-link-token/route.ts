/**
 * Generate a Plaid link_token for the authed user. The frontend opens
 * Plaid Link with this token to start the OAuth flow.
 *
 * Pass redirect_uri so OAuth-required banks (Chase, BofA, Wells, etc.)
 * work in Production. The URI MUST be registered in Plaid dashboard →
 * Team Settings → API → Allowed redirect URIs.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createLinkToken } from "@/lib/plaid";
import { getAppOrigin } from "@/lib/google-calendar";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const redirectUri = `${getAppOrigin().replace(/\/$/, "")}/integrations`;

  try {
    const linkToken = await createLinkToken(user.id, redirectUri);
    return NextResponse.json({ link_token: linkToken, redirect_uri: redirectUri });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "link_token_failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
