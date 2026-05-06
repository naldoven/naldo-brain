/**
 * /inbox/audit — Audit log of every archive in the last 30 days.
 * Each row has un-archive + mark-wrong buttons.
 */
import { InboxAuditView } from "@/components/inbox-audit-view";
import { createClient } from "@/lib/supabase/server";
import type {
  EmailAccountRow,
  EmailArchiveAuditRow,
  EmailMessageRow,
} from "@/lib/inbox/types";

export const dynamic = "force-dynamic";

export default async function InboxAuditPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // eslint-disable-next-line react-hooks/purity -- server component; time read is intentional
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: audits }, { data: accounts }] = await Promise.all([
    supabase
      .from("email_archive_audit")
      .select("*")
      .eq("user_id", user.id)
      .gte("archived_at", since)
      .order("archived_at", { ascending: false })
      .limit(500),
    supabase.from("email_accounts").select("*").eq("user_id", user.id),
  ]);

  const auditList = (audits || []) as EmailArchiveAuditRow[];
  let messages: EmailMessageRow[] = [];
  if (auditList.length > 0) {
    const ids = auditList.map((a) => a.message_id);
    const { data } = await supabase
      .from("email_messages")
      .select("*")
      .in("id", ids);
    messages = (data || []) as EmailMessageRow[];
  }

  return (
    <InboxAuditView
      audits={auditList}
      messages={messages}
      accounts={(accounts || []) as EmailAccountRow[]}
    />
  );
}
