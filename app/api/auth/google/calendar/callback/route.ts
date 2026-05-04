/**
 * Google OAuth redirect lands here. Exchange code for tokens, persist, redirect to /integrations.
 *
 * IMPORTANT: All redirects must use getAppOrigin() — Render's request.url is the internal
 * localhost URL which the browser can't follow.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getOAuthClient,
  persistTokens,
  getAppOrigin,
} from "@/lib/google-calendar";

export const runtime = "nodejs";

function publicRedirect(path: string): NextResponse {
  return NextResponse.redirect(`${getAppOrigin().replace(/\/$/, "")}${path}`);
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return publicRedirect("/login");
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return publicRedirect(`/integrations?error=${encodeURIComponent(error)}`);
  }

  // CSRF check
  const expectedState = request.cookies.get("google_oauth_state")?.value;
  if (!state || !expectedState || state !== expectedState) {
    return publicRedirect("/integrations?error=invalid_state");
  }

  if (!code) {
    return publicRedirect("/integrations?error=missing_code");
  }

  // Exchange code for tokens — must use the SAME origin we sent in the auth request
  const oauth2 = getOAuthClient(getAppOrigin());
  let tokens;
  try {
    const { tokens: t } = await oauth2.getToken(code);
    tokens = t;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "exchange_failed";
    return publicRedirect(`/integrations?error=${encodeURIComponent(msg)}`);
  }

  await persistTokens(supabase, user.id, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
    scope: tokens.scope,
  });

  const response = publicRedirect("/integrations?connected=google_calendar");
  response.cookies.delete("google_oauth_state");
  return response;
}
