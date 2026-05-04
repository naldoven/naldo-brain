/**
 * Google OAuth redirect lands here. Exchange code for tokens, persist, redirect to /integrations.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOAuthClient, persistTokens } from "@/lib/google-calendar";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/integrations?error=${encodeURIComponent(error)}`, request.url)
    );
  }

  // CSRF check
  const expectedState = request.cookies.get("google_oauth_state")?.value;
  if (!state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(
      new URL("/integrations?error=invalid_state", request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/integrations?error=missing_code", request.url)
    );
  }

  // Exchange code for tokens
  const oauth2 = getOAuthClient(request.nextUrl.origin);
  let tokens;
  try {
    const { tokens: t } = await oauth2.getToken(code);
    tokens = t;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "exchange_failed";
    return NextResponse.redirect(
      new URL(`/integrations?error=${encodeURIComponent(msg)}`, request.url)
    );
  }

  await persistTokens(supabase, user.id, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
    scope: tokens.scope,
  });

  const response = NextResponse.redirect(
    new URL("/integrations?connected=google_calendar", request.url)
  );
  response.cookies.delete("google_oauth_state");
  return response;
}
