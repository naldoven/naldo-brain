/**
 * Periodic Google Calendar sync. Pulls events for every connected user.
 * Hit every 15 min by Supabase pg_cron.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { pullEvents } from "@/lib/google-calendar";

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

  // Find every user with an active calendar connection
  const { data: connections } = await supabase
    .from("google_connections")
    .select("user_id")
    .eq("integration", "calendar")
    .not("refresh_token", "is", null);

  const results: Array<{ user_id: string; pulled: number; deleted: number; error?: string }> = [];

  for (const c of connections ?? []) {
    try {
      const { pulled, deleted } = await pullEvents(supabase, c.user_id);
      results.push({ user_id: c.user_id, pulled, deleted });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ user_id: c.user_id, pulled: 0, deleted: 0, error: msg });
    }
  }

  return NextResponse.json({
    users: results.length,
    results,
    ts: new Date().toISOString(),
  });
}
