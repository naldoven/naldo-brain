/**
 * /inbox — Inbox Agent dashboard. Lists every email_messages row with
 * status='pending', newest first. RLS scopes to the logged-in user.
 */
import { InboxView } from "@/components/inbox-view";
import { createClient } from "@/lib/supabase/server";
import type {
  EmailAccountRow,
  EmailLabelRow,
  EmailMessageRow,
} from "@/lib/inbox/types";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: messages }, { data: accounts }, { data: labels }] = await Promise.all([
    supabase
      .from("email_messages")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .order("received_at", { ascending: false })
      .limit(200),
    supabase.from("email_accounts").select("*").eq("user_id", user.id),
    supabase
      .from("email_labels")
      .select("*")
      .eq("user_id", user.id)
      .order("sort_order"),
  ]);

  return (
    <InboxView
      messages={(messages || []) as EmailMessageRow[]}
      accounts={(accounts || []) as EmailAccountRow[]}
      labels={(labels || []) as EmailLabelRow[]}
    />
  );
}
