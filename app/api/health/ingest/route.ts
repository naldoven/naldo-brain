/**
 * Native ingest endpoint — accepts the schema we control.
 *
 * Body: { metrics: [{ type, value, unit?, recorded_at, ended_at?, source?, metadata? }, ...] }
 * Auth: x-health-secret header
 * User: HEALTH_INGEST_USER_ID env var (single-user MVP)
 *
 * For Health Auto Export use /api/health/ingest-hae instead.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { z } from "zod";
import { METRIC_TYPES, upsertMetrics, type HealthRecord } from "@/lib/health";

export const runtime = "nodejs";

const metricSchema = z.object({
  type: z.enum(METRIC_TYPES),
  value: z.number().finite(),
  unit: z.string().max(16).optional().nullable(),
  recorded_at: z.string().datetime({ offset: true }),
  ended_at: z.string().datetime({ offset: true }).optional().nullable(),
  source: z
    .enum(["apple_health", "manual", "whoop", "garmin", "oura", "other"])
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

const bodySchema = z.object({
  metrics: z.array(metricSchema).min(1).max(2000),
});

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

  let parsed: z.infer<typeof bodySchema>;
  try {
    const json = await request.json();
    parsed = bodySchema.parse(json);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "invalid_body";
    return NextResponse.json({ error: "bad_request", detail: msg }, { status: 400 });
  }

  const supabase = createServerClient(supabaseUrl, serviceKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  });

  const records: HealthRecord[] = parsed.metrics.map((m) => ({
    metric_type: m.type,
    value: m.value,
    unit: m.unit ?? null,
    recorded_at: m.recorded_at,
    ended_at: m.ended_at ?? null,
    source: m.source ?? "apple_health",
    metadata: m.metadata ?? null,
  }));

  const result = await upsertMetrics(supabase, userId, records);
  if (result.error) {
    return NextResponse.json(
      { error: "insert_failed", detail: result.error },
      { status: 500 }
    );
  }

  return NextResponse.json({
    received: result.attempted,
    ts: new Date().toISOString(),
  });
}
