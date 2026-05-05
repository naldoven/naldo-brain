/**
 * Health Auto Export adapter.
 *
 * Accepts HAE's native JSON shape:
 *   { "data": { "metrics": [{ name, units, data: [{date, qty, ...}] }], "workouts": [...] } }
 *
 * Maps each metric to our internal schema (lib/health.ts → transformHaePayload),
 * then upserts via the shared helper. Idempotent.
 *
 * Auth: x-health-secret header (same secret as /api/health/ingest)
 * User: HEALTH_INGEST_USER_ID env var
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { transformHaePayload, upsertMetrics, type HaePayload } from "@/lib/health";

export const runtime = "nodejs";
// HAE batches can be sizeable on a daily aggregation cadence. Bumping the
// max body size for safety on App Router.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-health-secret");
  if (!secret || secret !== process.env.HEALTH_INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const userId = process.env.HEALTH_INGEST_USER_ID;
  if (!userId) {
    return NextResponse.json({ error: "owner_user_id_not_configured" }, { status: 503 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  let payload: HaePayload;
  try {
    payload = (await request.json()) as HaePayload;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "invalid_json";
    return NextResponse.json({ error: "bad_request", detail: msg }, { status: 400 });
  }

  if (!payload || typeof payload !== "object" || !payload.data) {
    return NextResponse.json(
      {
        error: "bad_request",
        detail: "expected payload shape: { data: { metrics: [...], workouts: [...] } }",
      },
      { status: 400 }
    );
  }

  let records;
  try {
    records = transformHaePayload(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "transform_failed";
    return NextResponse.json({ error: "transform_failed", detail: msg }, { status: 400 });
  }

  if (records.length === 0) {
    // Not an error — HAE happily POSTs empty windows. Tell the caller for visibility.
    return NextResponse.json({
      received: 0,
      mapped: 0,
      hint: "no recognised metrics in payload",
      ts: new Date().toISOString(),
    });
  }

  const supabase = createServerClient(supabaseUrl, serviceKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  });

  const result = await upsertMetrics(supabase, userId, records);
  if (result.error) {
    return NextResponse.json(
      { error: "insert_failed", detail: result.error },
      { status: 500 }
    );
  }

  // Tally by type so the response notification on the iPhone is informative.
  const byType: Record<string, number> = {};
  for (const r of records) {
    byType[r.metric_type] = (byType[r.metric_type] ?? 0) + 1;
  }

  return NextResponse.json({
    received: result.attempted,
    by_type: byType,
    ts: new Date().toISOString(),
  });
}
