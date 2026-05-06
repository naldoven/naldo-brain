/**
 * Plaid sync cron — pulls account balances + new transactions for every
 * Plaid Item belonging to PLAID_OWNER_USER_ID. Hit every 6h via pg_cron.
 *
 * Uses /transactions/sync cursor-incremental pulls so re-runs are cheap.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { syncFromPlaid } from "@/lib/plaid";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const userId = process.env.PLAID_OWNER_USER_ID;
  if (!userId) {
    return NextResponse.json(
      { error: "owner_user_id_not_configured" },
      { status: 503 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }
  const supabase = createServerClient(supabaseUrl, serviceKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  });

  try {
    const result = await syncFromPlaid(supabase, userId);
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
