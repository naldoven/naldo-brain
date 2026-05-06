/**
 * POST /api/cron/email-daily-summary
 *
 * Hit by Render Cron daily at 7am ET. For each user, builds an HTML digest
 * of yesterday's archives and emails it via that user's connected Gmail.
 *
 * Auth via CRON_SECRET. Service-role Supabase client.
 */
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  getGmailForAccount,
  sendEmail,
} from "@/lib/inbox/gmail";
import type {
  EmailAccountRow,
  EmailArchiveAuditRow,
  EmailMessageRow,
  EmailSettingsRow,
} from "@/lib/inbox/types";

export const maxDuration = 60;
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
    // Iterate per-user since the digest is per-user
    const { data: settingsRows } = await supabase
      .from("email_settings")
      .select("*")
      .eq("daily_summary_enabled", true);

    const results: { user_id: string; archived: number; sent: boolean }[] = [];
    for (const row of (settingsRows || []) as EmailSettingsRow[]) {
      const r = await sendDigestForUser(supabase, row);
      results.push({ user_id: row.user_id, ...r });
    }
    return NextResponse.json({ ok: true, perUser: results });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).stack || (err as Error).message },
      { status: 500 },
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  return POST(request);
}

async function sendDigestForUser(
  supabase: ReturnType<typeof createServerClient>,
  settings: EmailSettingsRow,
): Promise<{ archived: number; sent: boolean }> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: audits } = await supabase
    .from("email_archive_audit")
    .select("*")
    .eq("user_id", settings.user_id)
    .gte("archived_at", since)
    .is("unarchived_at", null)
    .order("archived_at", { ascending: false });
  const auditList = (audits || []) as EmailArchiveAuditRow[];
  if (auditList.length === 0) return { archived: 0, sent: false };

  const messageIds = auditList.map((a) => a.message_id);
  const [{ data: messages }, { data: accounts }] = await Promise.all([
    supabase.from("email_messages").select("*").in("id", messageIds),
    supabase
      .from("email_accounts")
      .select("*")
      .eq("user_id", settings.user_id),
  ]);
  const messageMap = new Map<string, EmailMessageRow>(
    (messages || []).map((m) => [(m as EmailMessageRow).id, m as EmailMessageRow]),
  );
  const accountMap = new Map<string, EmailAccountRow>(
    (accounts || []).map((a) => [(a as EmailAccountRow).id, a as EmailAccountRow]),
  );

  const fromAddress =
    settings.daily_summary_from ||
    (accounts && accounts[0] ? (accounts[0] as EmailAccountRow).email_address : null);
  const toAddress =
    settings.daily_summary_to || fromAddress;
  if (!fromAddress || !toAddress) {
    console.warn(
      `[email-daily-summary] no from/to for user ${settings.user_id}, skipping`,
    );
    return { archived: auditList.length, sent: false };
  }

  const senderAccount = (accounts || []).find(
    (a) => (a as EmailAccountRow).email_address === fromAddress,
  ) as EmailAccountRow | undefined;
  if (!senderAccount) {
    console.warn(
      `[email-daily-summary] no connected account for from=${fromAddress}`,
    );
    return { archived: auditList.length, sent: false };
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://naldo-brain.onrender.com";

  const html = renderHtml({
    audits: auditList,
    messageMap,
    accountMap,
    baseUrl,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gmail = await getGmailForAccount(supabase as any, senderAccount);
  await sendEmail({
    gmail,
    to: toAddress,
    subject: `Inbox · ${auditList.length} archived in the last 24h`,
    bodyHtml: html,
  });

  return { archived: auditList.length, sent: true };
}

function renderHtml(args: {
  audits: EmailArchiveAuditRow[];
  messageMap: Map<string, EmailMessageRow>;
  accountMap: Map<string, EmailAccountRow>;
  baseUrl: string;
}): string {
  const rows = args.audits
    .map((a) => {
      const m = args.messageMap.get(a.message_id);
      if (!m) return "";
      const acc = args.accountMap.get(m.account_id);
      return `
        <tr style="border-bottom:1px solid #eee">
          <td style="padding:10px 8px;font-size:13px;color:#666;white-space:nowrap;width:90px">${esc(timeShort(a.archived_at))}</td>
          <td style="padding:10px 8px">
            <div style="font-weight:600;font-size:14px">${esc(m.from_name || m.from_address)}</div>
            <div style="font-size:13px;color:#333">${esc(m.subject || "(no subject)")}</div>
            <div style="font-size:12px;color:#888;margin-top:2px">${esc(m.snippet?.slice(0, 100) || "")}</div>
            <div style="font-size:11px;color:#aaa;margin-top:4px">${esc(acc?.display_label || acc?.email_address || "?")} · ${esc(m.reason)}</div>
          </td>
          <td style="padding:10px 8px;text-align:right;white-space:nowrap">
            <a href="${args.baseUrl}/inbox/audit" style="background:#f59e0b;color:#0a0a0a;padding:6px 10px;border-radius:4px;text-decoration:none;font-size:12px;font-weight:600">Un-archive</a>
          </td>
        </tr>`;
    })
    .join("");

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f7f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:640px;margin:0 auto;background:white;border-radius:8px;overflow:hidden">
    <div style="padding:20px 24px;background:#0a0a0a;color:white">
      <h1 style="margin:0;font-size:20px"><span style="color:#f59e0b">●</span> Inbox · Daily Summary</h1>
      <p style="margin:6px 0 0;font-size:13px;color:#a3a3a3">${args.audits.length} email${args.audits.length === 1 ? "" : "s"} archived in the last 24 hours</p>
    </div>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    <div style="padding:16px 24px;text-align:center;background:#f7f7f5;font-size:12px;color:#666">
      <a href="${args.baseUrl}/inbox/audit" style="color:#0a0a0a">View all in dashboard →</a>
    </div>
  </div>
</body></html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function timeShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
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
