/**
 * POST /api/cron/email-triage
 *
 * Hit by Render Cron every 10 minutes. Runs the triage loop across all active
 * email_accounts. Authenticated via CRON_SECRET.
 *
 * Service-role Supabase client — bypasses RLS so we can process every user's
 * accounts in one tick.
 */
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { runTriageForAllAccounts } from "@/lib/inbox/triage/run";

export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
    const stats = await runTriageForAllAccounts(supabase);
    const totals = stats.reduce(
      (acc, s) => ({
        fetched: acc.fetched + s.fetched,
        alreadySeen: acc.alreadySeen + s.alreadySeen,
        archived: acc.archived + s.archived,
        drafted: acc.drafted + s.drafted,
        queuedNoDraft: acc.queuedNoDraft + s.queuedNoDraft,
        blockedByRule: acc.blockedByRule + s.blockedByRule,
        errors: acc.errors + s.errors,
      }),
      {
        fetched: 0, alreadySeen: 0, archived: 0, drafted: 0,
        queuedNoDraft: 0, blockedByRule: 0, errors: 0,
      },
    );
    return NextResponse.json({ ok: true, totals, perAccount: stats });
  } catch (err) {
    const msg = (err as Error).stack || (err as Error).message;
    console.error("[cron/email-triage] failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(request: Request): Promise<Response> {
  return POST(request);
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") || "";
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  if (url.searchParams.get("secret") === secret) return true;
  return false;
}
