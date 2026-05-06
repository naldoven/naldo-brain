/**
 * GET /api/auth/google/gmail/callback
 *
 * Google's OAuth redirect lands here. Exchange code for tokens, identify the
 * authorized email (id_token → userinfo → getProfile fallback chain), encrypt
 * the refresh token, persist into email_accounts. Redirect to /inbox.
 *
 * Resilient against Gmail rate limits — uses id_token and userinfo as primary
 * email-lookup paths so we don't depend on a Gmail API call to complete auth.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGmailOAuthClient } from "@/lib/inbox/gmail";
import { encrypt } from "@/lib/inbox/encrypt";
import { getAppOrigin } from "@/lib/google-calendar";

export const runtime = "nodejs";

function appRedirect(path: string): NextResponse {
  return NextResponse.redirect(`${getAppOrigin().replace(/\/$/, "")}${path}`);
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return appRedirect("/login");

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return appRedirect(`/inbox?error=${encodeURIComponent(error)}`);
  }

  // CSRF check
  const expectedState = request.cookies.get("gmail_oauth_state")?.value;
  if (!state || !expectedState || state !== expectedState) {
    return appRedirect("/inbox?error=invalid_state");
  }

  if (!code) return appRedirect("/inbox?error=missing_code");

  const oauth2 = getGmailOAuthClient(getAppOrigin());
  let tokens;
  try {
    const { tokens: t } = await oauth2.getToken(code);
    tokens = t;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "exchange_failed";
    return appRedirect(`/inbox?error=${encodeURIComponent(msg)}`);
  }

  if (!tokens.refresh_token) {
    return appRedirect(
      `/inbox?error=${encodeURIComponent("no_refresh_token__remove_grant_and_retry")}`,
    );
  }

  // Identify the email — try id_token (no API call), then userinfo, then getProfile.
  let emailAddress: string | null = null;
  if (tokens.id_token) {
    try {
      const payload = JSON.parse(
        Buffer.from(tokens.id_token.split(".")[1], "base64url").toString("utf8"),
      );
      if (typeof payload.email === "string") emailAddress = payload.email;
    } catch {
      // fall through
    }
  }
  if (!emailAddress && tokens.access_token) {
    try {
      const res = await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      );
      if (res.ok) {
        const data = (await res.json()) as { email?: string };
        if (data.email) emailAddress = data.email;
      }
    } catch {
      // fall through
    }
  }
  if (!emailAddress) {
    return appRedirect(
      `/inbox?error=${encodeURIComponent("could_not_identify_email__try_again")}`,
    );
  }

  emailAddress = emailAddress.toLowerCase();

  // Persist (or update) the email_accounts row for this user+email.
  // RLS allows because user is logged in and user_id matches.
  const { data: existing } = await supabase
    .from("email_accounts")
    .select("id")
    .eq("user_id", user.id)
    .eq("email_address", emailAddress)
    .maybeSingle();

  const update = {
    refresh_token_encrypted: encrypt(tokens.refresh_token),
    access_token: tokens.access_token ?? null,
    access_token_expires_at: tokens.expiry_date
      ? new Date(tokens.expiry_date).toISOString()
      : null,
    is_active: true,
  };

  if (existing) {
    await supabase.from("email_accounts").update(update).eq("id", existing.id);
  } else {
    await supabase.from("email_accounts").insert({
      user_id: user.id,
      email_address: emailAddress,
      display_label: emailAddress,
      last_polled_at: new Date().toISOString(),
      ...update,
    });
  }

  const response = appRedirect(
    `/inbox?connected=${encodeURIComponent(emailAddress)}`,
  );
  response.cookies.delete("gmail_oauth_state");
  return response;
}
