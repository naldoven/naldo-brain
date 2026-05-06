/**
 * User-facing "Sync now" trigger.
 *
 * Session-authed (cookie). Dispatches to the same sync libraries the cron
 * endpoints use, but scoped to the current user. Avoids round-tripping
 * through the cron HTTP endpoint + cron-secret since we already have a
 * trusted server context.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServerClient } from "@supabase/ssr";
import { pullEvents } from "@/lib/google-calendar";
import { syncFromGhl } from "@/lib/gohighlevel";
import { syncFromPlaid } from "@/lib/plaid";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  kind: z.enum(["google_calendar", "ghl", "plaid"]),
});

export async function POST(request: NextRequest) {
  const cookieClient = await createClient();
  const {
    data: { user },
  } = await cookieClient.auth.getUser();
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }
  // Service-role client so writes bypass RLS — same pattern the cron endpoints
  // use. The session user.id from above scopes the work to the right rows.
  const supabase = createServerClient(supabaseUrl, serviceKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  });

  try {
    switch (parsed.kind) {
      case "google_calendar": {
        const result = await pullEvents(supabase, user.id);
        return NextResponse.json({ ok: true, ...result, ts: new Date().toISOString() });
      }
      case "ghl": {
        const token = process.env.GHL_API_KEY;
        const locationId = process.env.GHL_LOCATION_ID;
        if (!token || !locationId) {
          return NextResponse.json(
            { error: "ghl_not_configured" },
            { status: 503 }
          );
        }
        const result = await syncFromGhl(supabase, user.id, token, locationId);
        return NextResponse.json({
          ok: result.errors.length === 0,
          ...result,
          ts: new Date().toISOString(),
        });
      }
      case "plaid": {
        const result = await syncFromPlaid(supabase, user.id);
        return NextResponse.json({
          ok: result.errors.length === 0,
          ...result,
          ts: new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: "sync_failed", detail: msg },
      { status: 500 }
    );
  }
}
