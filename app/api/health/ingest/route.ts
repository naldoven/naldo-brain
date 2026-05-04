/**
 * Apple Health ingest endpoint.
 *
 * Hit by an iOS Shortcut on Naldo's iPhone with the x-health-secret header.
 * Body shape:
 *   { metrics: [
 *       { type: "steps", value: 8234, unit: "count", recorded_at: "2026-05-04T08:00:00-04:00", ended_at?: ..., metadata?: {...} },
 *       ...
 *     ]
 *   }
 *
 * Idempotent — uses (user_id, metric_type, recorded_at, source) unique constraint.
 * Single-user MVP: HEALTH_INGEST_USER_ID env var attaches all rows to Naldo.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { z } from "zod";

export const runtime = "nodejs";

const METRIC_TYPES = [
  "weight", "body_fat_percent", "lean_body_mass", "body_temperature",
  "steps", "distance_meters", "flights_climbed",
  "active_calories", "basal_calories", "exercise_minutes", "stand_hours",
  "heart_rate", "resting_heart_rate", "hrv_ms",
  "systolic_bp", "diastolic_bp", "spo2", "vo2_max",
  "sleep_hours", "sleep_efficiency", "time_in_bed_hours",
  "workout_minutes", "workout_calories", "workout_distance_meters",
  "mindful_minutes",
  "water_ml", "caffeine_mg", "protein_g", "carbs_g", "fat_g", "calories_consumed",
] as const;

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
    return NextResponse.json(
      { error: "owner_user_id_not_configured" },
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

  const rows = parsed.metrics.map((m) => ({
    user_id: userId,
    metric_type: m.type,
    value: m.value,
    unit: m.unit ?? null,
    recorded_at: m.recorded_at,
    ended_at: m.ended_at ?? null,
    source: m.source ?? "apple_health",
    metadata: m.metadata ?? null,
  }));

  // Upsert ignores duplicates — Shortcut may resend the same window without
  // creating dupes. ignoreDuplicates uses INSERT ... ON CONFLICT DO NOTHING.
  const { error } = await supabase
    .from("health_metrics")
    .upsert(rows, {
      onConflict: "user_id,metric_type,recorded_at,source",
      ignoreDuplicates: true,
    });

  if (error) {
    return NextResponse.json(
      { error: "insert_failed", detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    received: rows.length,
    ts: new Date().toISOString(),
  });
}
