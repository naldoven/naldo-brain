/**
 * Health Metrics shared library.
 *
 * Used by both /api/health/ingest (our native format) and
 * /api/health/ingest-hae (Health Auto Export adapter). Centralises:
 * - The list of allowed metric_type values (must match migration 0008's check)
 * - The internal record shape (matches health_metrics columns)
 * - upsertMetrics() — idempotent insert via the unique constraint
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Personal targets used by the Health page + brief LLM. Override via env vars
 * if you want to adjust without a redeploy. Single-user MVP — when we move to
 * multi-user we'll back this with a `health_goals` table per user.
 */
export const HEALTH_GOALS = {
  weight_lbs: Number(process.env.HEALTH_GOAL_WEIGHT_LBS ?? 200),
  steps_daily: Number(process.env.HEALTH_GOAL_STEPS_DAILY ?? 10000),
  sleep_hours_nightly: Number(process.env.HEALTH_GOAL_SLEEP_HOURS ?? 7),
  workout_days_weekly: Number(process.env.HEALTH_GOAL_WORKOUT_DAYS ?? 3),
};

export const METRIC_TYPES = [
  // Body
  "weight", "body_fat_percent", "lean_body_mass", "body_temperature",
  // Movement
  "steps", "distance_meters", "flights_climbed",
  "active_calories", "basal_calories", "exercise_minutes", "stand_hours",
  // Cardio
  "heart_rate", "resting_heart_rate", "hrv_ms",
  "systolic_bp", "diastolic_bp", "spo2", "vo2_max",
  // Sleep
  "sleep_hours", "sleep_efficiency", "time_in_bed_hours",
  // Workouts
  "workout_minutes", "workout_calories", "workout_distance_meters",
  // Mind
  "mindful_minutes",
  // Nutrition
  "water_ml", "caffeine_mg", "protein_g", "carbs_g", "fat_g", "calories_consumed",
] as const;

export type MetricType = typeof METRIC_TYPES[number];

export type HealthRecord = {
  metric_type: MetricType;
  value: number;
  unit: string | null;
  recorded_at: string;            // ISO 8601 with offset
  ended_at?: string | null;
  source?: "apple_health" | "manual" | "whoop" | "garmin" | "oura" | "other";
  metadata?: Record<string, unknown> | null;
};

/**
 * Idempotent bulk upsert. Returns rows attempted (not rows actually inserted —
 * Supabase doesn't return a count when ignoreDuplicates is true).
 */
export async function upsertMetrics(
  supabase: SupabaseClient,
  userId: string,
  records: HealthRecord[]
): Promise<{ attempted: number; error?: string }> {
  if (records.length === 0) return { attempted: 0 };

  const rows = records.map((r) => ({
    user_id: userId,
    metric_type: r.metric_type,
    value: r.value,
    unit: r.unit ?? null,
    recorded_at: r.recorded_at,
    ended_at: r.ended_at ?? null,
    source: r.source ?? "apple_health",
    metadata: r.metadata ?? null,
  }));

  // Chunk to keep the Postgres parameter count under control on big batches.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("health_metrics")
      .upsert(chunk, {
        onConflict: "user_id,metric_type,recorded_at,source",
        ignoreDuplicates: true,
      });
    if (error) return { attempted: rows.length, error: error.message };
  }

  return { attempted: rows.length };
}

/**
 * Parse Health Auto Export's date format ("YYYY-MM-DD HH:mm:ss ±HHMM") into
 * an ISO 8601 string with a colon-separated offset. Falls back to native
 * Date parsing for already-ISO strings.
 */
export function parseHaeDate(s: string): string {
  if (!s) throw new Error("empty_date");
  // HAE: "2026-05-04 08:00:00 -0400"
  const m = s.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*([+-]\d{2}):?(\d{2})$/
  );
  if (m) return `${m[1]}T${m[2]}${m[3]}:${m[4]}`;
  // Fallback: trust the parser
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  throw new Error(`unparseable_date: ${s}`);
}

/**
 * Map HAE metric names → our metric_type. Names absent from the table are
 * skipped (silently — they're often things we don't care about like
 * `respiratory_rate` or `walking_heart_rate_average`).
 */
const HAE_NAME_MAP: Record<string, MetricType> = {
  // Movement
  step_count: "steps",
  walking_running_distance: "distance_meters",
  flights_climbed: "flights_climbed",
  active_energy: "active_calories",
  basal_energy_burned: "basal_calories",
  apple_exercise_time: "exercise_minutes",
  apple_stand_time: "stand_hours",

  // Body
  weight_body_mass: "weight",
  body_mass: "weight",
  body_fat_percentage: "body_fat_percent",
  lean_body_mass: "lean_body_mass",
  body_temperature: "body_temperature",
  basal_body_temperature: "body_temperature",

  // Cardio
  heart_rate: "heart_rate",
  resting_heart_rate: "resting_heart_rate",
  heart_rate_variability: "hrv_ms",
  blood_pressure_systolic: "systolic_bp",
  blood_pressure_diastolic: "diastolic_bp",
  oxygen_saturation: "spo2",
  vo2_max: "vo2_max",

  // Mind / mindfulness
  mindful_session: "mindful_minutes",

  // Nutrition
  dietary_water: "water_ml",
  dietary_caffeine: "caffeine_mg",
  dietary_protein: "protein_g",
  dietary_carbohydrates: "carbs_g",
  dietary_fat_total: "fat_g",
  dietary_energy: "calories_consumed",
};

export type HaePayload = {
  data?: {
    metrics?: HaeMetric[];
    workouts?: HaeWorkout[];
  };
};

type HaeMetric = {
  name?: string;
  units?: string;
  data?: HaeSample[];
};

type HaeSample = {
  date?: string;
  qty?: number | string;
  // Sleep samples expose multiple fields in the same row
  asleep?: number;
  inBed?: number;
  deep?: number;
  rem?: number;
  core?: number;
  awake?: number;
  source?: string;
  // Blood pressure (composite in some HAE versions)
  systolic?: number;
  diastolic?: number;
  // Mindful sessions
  duration?: number;
};

type HaeWorkout = {
  name?: string;
  start?: string;
  end?: string;
  duration?: number;                                  // usually minutes
  totalEnergyBurned?: number | { qty?: number; units?: string };
  activeEnergyBurned?: number | { qty?: number; units?: string };
  distance?: number | { qty?: number; units?: string };
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  if (v && typeof v === "object" && "qty" in (v as object)) {
    return num((v as { qty: unknown }).qty);
  }
  return null;
}

function unitFor(haeUnits: string | undefined, mapped: MetricType): string {
  if (haeUnits) return haeUnits;
  // Sensible defaults when HAE omits the unit
  if (mapped === "weight") return "lbs";
  if (mapped === "steps") return "count";
  if (mapped.endsWith("_calories")) return "kcal";
  if (mapped === "heart_rate" || mapped === "resting_heart_rate") return "bpm";
  if (mapped === "hrv_ms") return "ms";
  if (mapped === "sleep_hours") return "hr";
  if (mapped === "workout_minutes" || mapped === "exercise_minutes" || mapped === "mindful_minutes")
    return "min";
  if (mapped === "distance_meters") return "m";
  return "";
}

/** Convert a HAE payload to our internal HealthRecord shape. */
export function transformHaePayload(payload: HaePayload): HealthRecord[] {
  const out: HealthRecord[] = [];

  for (const m of payload.data?.metrics ?? []) {
    if (!m.name || !m.data) continue;
    const lname = m.name.toLowerCase();

    // Sleep is a special composite — emit one sleep_hours record per day from `asleep`,
    // plus time_in_bed_hours from `inBed` if present.
    if (lname === "sleep_analysis") {
      for (const s of m.data) {
        if (!s.date) continue;
        let recordedAt: string;
        try {
          recordedAt = parseHaeDate(s.date);
        } catch {
          continue;
        }
        const asleep = num(s.asleep);
        const inBed = num(s.inBed);
        if (asleep !== null && asleep > 0) {
          out.push({
            metric_type: "sleep_hours",
            value: asleep,
            unit: "hr",
            recorded_at: recordedAt,
            metadata: {
              deep: s.deep ?? null,
              rem: s.rem ?? null,
              core: s.core ?? null,
              awake: s.awake ?? null,
            },
          });
        }
        if (inBed !== null && inBed > 0) {
          out.push({
            metric_type: "time_in_bed_hours",
            value: inBed,
            unit: "hr",
            recorded_at: recordedAt,
          });
        }
      }
      continue;
    }

    // Blood pressure can come either as one composite metric or as two separate ones
    if (lname === "blood_pressure") {
      for (const s of m.data) {
        if (!s.date) continue;
        const recordedAt = parseHaeDate(s.date);
        const sys = num(s.systolic);
        const dia = num(s.diastolic);
        if (sys !== null) {
          out.push({ metric_type: "systolic_bp", value: sys, unit: "mmHg", recorded_at: recordedAt });
        }
        if (dia !== null) {
          out.push({ metric_type: "diastolic_bp", value: dia, unit: "mmHg", recorded_at: recordedAt });
        }
      }
      continue;
    }

    const mapped = HAE_NAME_MAP[lname];
    if (!mapped) continue;

    for (const s of m.data) {
      if (!s.date) continue;
      let recordedAt: string;
      try {
        recordedAt = parseHaeDate(s.date);
      } catch {
        continue;
      }
      // Most metrics use `qty`; mindfulness uses `duration` (minutes).
      const value = num(lname === "mindful_session" ? s.duration : s.qty);
      if (value === null || !Number.isFinite(value)) continue;

      out.push({
        metric_type: mapped,
        value,
        unit: unitFor(m.units, mapped),
        recorded_at: recordedAt,
      });
    }
  }

  // Workouts → workout_minutes (computed from start/end if present)
  for (const w of payload.data?.workouts ?? []) {
    if (!w.start) continue;
    let startIso: string;
    try {
      startIso = parseHaeDate(w.start);
    } catch {
      continue;
    }
    let endIso: string | null = null;
    if (w.end) {
      try {
        endIso = parseHaeDate(w.end);
      } catch {
        /* keep null */
      }
    }

    let minutes: number | null = null;
    if (endIso) {
      minutes = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
    } else if (typeof w.duration === "number") {
      // HAE has historically used minutes; some versions used hours. Heuristic: a
      // value < 5 is almost certainly hours (no one logs <5min workouts often).
      minutes = w.duration < 5 ? w.duration * 60 : w.duration;
    }
    if (minutes !== null && minutes > 0) {
      out.push({
        metric_type: "workout_minutes",
        value: Math.round(minutes),
        unit: "min",
        recorded_at: startIso,
        ended_at: endIso ?? undefined,
        metadata: { name: w.name ?? null },
      });
    }

    const calories = num(w.activeEnergyBurned ?? w.totalEnergyBurned);
    if (calories !== null && calories > 0) {
      out.push({
        metric_type: "workout_calories",
        value: calories,
        unit: "kcal",
        recorded_at: startIso,
        ended_at: endIso ?? undefined,
      });
    }

    const distance = num(w.distance);
    if (distance !== null && distance > 0) {
      // HAE distance typically in miles or km; we store meters. Heuristic on units field.
      let meters = distance;
      if (typeof w.distance === "object" && w.distance && "units" in w.distance) {
        const u = String((w.distance as { units?: string }).units ?? "").toLowerCase();
        if (u === "mi" || u === "miles") meters = distance * 1609.344;
        else if (u === "km") meters = distance * 1000;
      } else {
        // Reasonable assumption: a workout >50 likely meters; <50 likely km/mi
        if (distance < 50) meters = distance * 1609.344; // assume miles for US users
      }
      out.push({
        metric_type: "workout_distance_meters",
        value: Math.round(meters),
        unit: "m",
        recorded_at: startIso,
        ended_at: endIso ?? undefined,
      });
    }
  }

  return out;
}
