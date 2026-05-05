/**
 * GoHighLevel v2 client + sync logic.
 *
 * Auth: Private Integration Token via `Authorization: Bearer <PIT>`.
 * Base: https://services.leadconnectorhq.com/
 * Version: 2021-07-28 (per current PIT docs).
 *
 * The sync function pulls opportunities + pipelines for one location and
 * upserts into the local mirror tables. Re-syncs are idempotent on
 * (user_id, external_id).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

// ---- Types — only what we use; everything else stays in `raw` jsonb. ------

type GhlContact = {
  id?: string;
  name?: string;
  email?: string;
  phone?: string;
};

type GhlOpportunity = {
  id: string;
  name?: string;
  monetaryValue?: number;
  status?: string;                // 'open' | 'won' | 'lost' | 'abandoned'
  pipelineId?: string;
  pipelineStageId?: string;
  contactId?: string;
  contact?: GhlContact;
  source?: string;
  assignedTo?: string;
  createdAt?: string;
  updatedAt?: string;
  lastStatusChangeAt?: string;
  lastStageChangeAt?: string;
};

type GhlSearchResponse = {
  opportunities?: GhlOpportunity[];
  total?: number;
  meta?: {
    nextPage?: string | number | null;
    nextPageUrl?: string;
    startAfter?: string | null;
    startAfterId?: string | null;
  };
};

type GhlPipeline = {
  id: string;
  name?: string;
  stages?: { id: string; name?: string; position?: number }[];
};

type GhlPipelinesResponse = {
  pipelines?: GhlPipeline[];
};

// ---- Low-level HTTP -------------------------------------------------------

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Version: GHL_VERSION,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function ghlFetch<T>(
  path: string,
  init: RequestInit & { token: string }
): Promise<T> {
  const url = path.startsWith("http") ? path : `${GHL_BASE}${path}`;
  const { token, headers, ...rest } = init;
  const merged: HeadersInit = { ...authHeaders(token), ...(headers ?? {}) };

  const res = await fetch(url, { ...rest, headers: merged });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GHL ${rest.method ?? "GET"} ${path} → ${res.status}${body ? ` :: ${body.slice(0, 400)}` : ""}`
    );
  }
  return (await res.json()) as T;
}

// ---- Public API -----------------------------------------------------------

export async function fetchPipelines(
  token: string,
  locationId: string
): Promise<GhlPipeline[]> {
  const res = await ghlFetch<GhlPipelinesResponse>(
    `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
    { token, method: "GET" }
  );
  return res.pipelines ?? [];
}

/**
 * Page through every opportunity in a location. The Search endpoint paginates
 * via either `meta.startAfter` + `meta.startAfterId` or `meta.nextPageUrl` —
 * we honor whichever GHL returns. Hard-cap at 50 pages so a buggy cursor
 * loop can't melt the dyno.
 */
export async function fetchAllOpportunities(
  token: string,
  locationId: string,
  options: { pageSize?: number; updatedSince?: string } = {}
): Promise<{ items: GhlOpportunity[]; lastMeta?: unknown; pages: number }> {
  const pageSize = options.pageSize ?? 100;
  const out: GhlOpportunity[] = [];
  let lastMeta: unknown = undefined;
  let pages = 0;

  let startAfter: string | null = null;
  let startAfterId: string | null = null;
  let nextUrl: string | null = null;

  for (let page = 0; page < 50; page++) {
    // GHL v2 uses `limit` (max 100), not `pageLimit` — the schema validator
    // rejects unknown fields with a 422.
    const body: Record<string, unknown> = {
      locationId,
      limit: pageSize,
    };
    if (options.updatedSince) body.date = options.updatedSince;
    if (startAfter) body.startAfter = startAfter;
    if (startAfterId) body.startAfterId = startAfterId;

    const path: string = nextUrl ?? "/opportunities/search";
    const isCursorRequest = nextUrl !== null;
    const res: GhlSearchResponse = await ghlFetch<GhlSearchResponse>(path, {
      token,
      method: isCursorRequest ? "GET" : "POST",
      body: isCursorRequest ? undefined : JSON.stringify(body),
    });

    const items = res.opportunities ?? [];
    if (items.length === 0) break;
    out.push(...items);
    pages++;

    const meta = (res.meta ?? {}) as Record<string, unknown>;
    lastMeta = meta;

    // Style 1: explicit next-page URL
    if (typeof meta.nextPageUrl === "string" && meta.nextPageUrl) {
      nextUrl = meta.nextPageUrl;
      startAfter = null;
      startAfterId = null;
      continue;
    }
    // Style 2: cursor (startAfter + startAfterId — strings or numbers)
    if (
      meta.startAfter !== undefined &&
      meta.startAfter !== null &&
      meta.startAfterId !== undefined &&
      meta.startAfterId !== null
    ) {
      nextUrl = null;
      startAfter = String(meta.startAfter);
      startAfterId = String(meta.startAfterId);
      continue;
    }
    // No further cursor — done.
    break;
  }

  return { items: out, lastMeta, pages };
}

// ---- Sync into local Postgres --------------------------------------------

/**
 * Pull pipelines + opportunities from GHL and upsert into local tables.
 * Returns counts so the cron endpoint can return a useful response.
 */
export async function syncFromGhl(
  supabase: SupabaseClient,
  userId: string,
  token: string,
  locationId: string
): Promise<{
  opportunities: number;
  pipelines: number;
  pages: number;
  lastMeta?: unknown;
  errors: string[];
}> {
  const errors: string[] = [];

  // --- Pipelines (small, sync first so we can denormalise stage names below)
  let pipelines: GhlPipeline[] = [];
  try {
    pipelines = await fetchPipelines(token, locationId);
  } catch (err) {
    errors.push(`fetchPipelines: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Build (pipelineId, stageId) → names lookup
  const pipelineNameById = new Map<string, string>();
  const stageNameById = new Map<string, string>();
  for (const p of pipelines) {
    if (p.id) pipelineNameById.set(p.id, p.name ?? "");
    for (const s of p.stages ?? []) {
      if (s.id) stageNameById.set(s.id, s.name ?? "");
    }
  }

  // Upsert pipelines table
  if (pipelines.length > 0) {
    const pipelineRows = pipelines.map((p) => ({
      user_id: userId,
      external_id: p.id,
      name: p.name ?? null,
      stages: p.stages ?? [],
      raw: p,
      synced_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from("gohighlevel_pipelines")
      .upsert(pipelineRows, { onConflict: "user_id,external_id" });
    if (error) errors.push(`pipelines upsert: ${error.message}`);
  }

  // --- Opportunities
  let opps: GhlOpportunity[] = [];
  let lastMeta: unknown = undefined;
  let pages = 0;
  try {
    const result = await fetchAllOpportunities(token, locationId);
    opps = result.items;
    lastMeta = result.lastMeta;
    pages = result.pages;
  } catch (err) {
    errors.push(`fetchAllOpportunities: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (opps.length > 0) {
    const oppRows = opps.map((o) => ({
      user_id: userId,
      external_id: o.id,
      name: o.name ?? null,
      monetary_value: typeof o.monetaryValue === "number" ? o.monetaryValue : 0,
      status: normaliseStatus(o.status),
      pipeline_id: o.pipelineId ?? null,
      pipeline_stage_id: o.pipelineStageId ?? null,
      pipeline_name: o.pipelineId ? pipelineNameById.get(o.pipelineId) ?? null : null,
      pipeline_stage_name: o.pipelineStageId
        ? stageNameById.get(o.pipelineStageId) ?? null
        : null,
      contact_id: o.contactId ?? o.contact?.id ?? null,
      contact_name: o.contact?.name ?? null,
      contact_email: o.contact?.email ?? null,
      contact_phone: o.contact?.phone ?? null,
      source: o.source ?? null,
      assigned_to: o.assignedTo ?? null,
      ghl_created_at: parseDate(o.createdAt),
      ghl_updated_at: parseDate(o.updatedAt),
      ghl_status_changed_at: parseDate(o.lastStatusChangeAt),
      ghl_stage_changed_at: parseDate(o.lastStageChangeAt),
      raw: o,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    // Chunk to keep INSERT params under Postgres' bind-parameter ceiling.
    const CHUNK = 250;
    for (let i = 0; i < oppRows.length; i += CHUNK) {
      const chunk = oppRows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("gohighlevel_opportunities")
        .upsert(chunk, { onConflict: "user_id,external_id" });
      if (error) errors.push(`opportunities upsert (batch ${i}): ${error.message}`);
    }
  }

  return {
    opportunities: opps.length,
    pipelines: pipelines.length,
    pages,
    lastMeta,
    errors,
  };
}

function normaliseStatus(s: string | undefined): string | null {
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower === "open" || lower === "won" || lower === "lost" || lower === "abandoned") {
    return lower;
  }
  return null;
}

function parseDate(s: string | undefined | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
