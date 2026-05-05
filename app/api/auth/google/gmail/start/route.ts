/**
 * GET /api/auth/google/gmail/start
 *
 * Kicks off Gmail OAuth. Sets a CSRF state cookie, redirects to Google.
 * After consent, Google redirects to /api/auth/google/gmail/callback.
 *
 * Multi-account: unlike calendar (one connection per user), users can have
 * multiple Gmail accounts. Each /start → /callback flow connects ONE account
 * (whichever the user picks at Google's account-picker).
 */
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { buildGmailAuthorizeUrl } from "@/lib/inbox/gmail";
import { getAppOrigin } from "@/lib/google-calendar";

export const runtime = "nodejs";

export async function GET(_request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${getAppOrigin().replace(/\/$/, "")}/login`);
  }

  const state = randomBytes(24).toString("hex");
  const url = buildGmailAuthorizeUrl(state, getAppOrigin());

  const response = NextResponse.redirect(url);
  response.cookies.set("gmail_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60, // 10 min
  });
  return response;
}
