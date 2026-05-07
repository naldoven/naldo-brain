/**
 * Midnight task rollover.
 *
 * Tasks tagged 'today' that didn't get finished by end-of-day should not
 * silently linger as "today" forever — that breaks the whole point of the
 * status. At ~midnight Naldo time, push every non-done 'today' task back
 * to 'this_week' so tomorrow he gets a clean today list.
 *
 * Hit by Supabase pg_cron at 05:00 UTC daily (= midnight-ish in NY across
 * EST/EDT). Idempotent — re-running is a no-op.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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

  const now = new Date().toISOString();

  // Roll every still-open 'today' task back to 'this_week'.
  // 'in_progress' is included because it didn't finish today either.
  const { data, error } = await supabase
    .from("tasks")
    .update({
      status: "this_week",
      updated_at: now,
    })
    .in("status", ["today", "in_progress"])
    .neq("status", "done")
    .select("id");

  if (error) {
    return NextResponse.json(
      { error: "rollover_failed", detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    rolled: data?.length ?? 0,
    ts: now,
  });
}
