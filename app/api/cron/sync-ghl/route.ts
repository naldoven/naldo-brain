/**
 * GoHighLevel sync cron.
 *
 * Hit every 30 min by Supabase pg_cron with the shared CRON_SECRET. Pulls
 * pipelines + opportunities for the configured location and upserts into the
 * local mirror tables.
 *
 * Single-user MVP: GHL_API_KEY (PIT), GHL_LOCATION_ID, GHL_OWNER_USER_ID env vars.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { syncFromGhl } from "@/lib/gohighlevel";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  const userId = process.env.GHL_OWNER_USER_ID;
  if (!token || !locationId || !userId) {
    return NextResponse.json(
      {
        error: "ghl_not_configured",
        missing: {
          GHL_API_KEY: !token,
          GHL_LOCATION_ID: !locationId,
          GHL_OWNER_USER_ID: !userId,
        },
      },
      { status: 503 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "supabase_not_configured" },
      { status: 503 }
    );
  }

  const supabase = createServerClient(supabaseUrl, serviceKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  });

  try {
    const result = await syncFromGhl(supabase, userId, token, locationId);
    return NextResponse.json({
      ok: result.errors.length === 0,
      ...result,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: "sync_failed", detail: msg },
      { status: 500 }
    );
  }
}
