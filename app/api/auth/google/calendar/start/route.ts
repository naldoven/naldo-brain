/**
 * Initiates Google Calendar OAuth.
 * GET → redirects user to Google's consent screen.
 * State stored in HTTP-only cookie for CSRF protection.
 */
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { buildAuthorizeUrl } from "@/lib/google-calendar";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const state = randomBytes(24).toString("hex");
  const origin = request.nextUrl.origin;

  const authorizeUrl = buildAuthorizeUrl(state, origin);

  const response = NextResponse.redirect(authorizeUrl);
  // 10-minute window to complete the flow
  response.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/api/auth/google",
  });
  return response;
}
