/**
 * /inbox/settings — Voice profiles, style guides, labels, and connected
 * accounts. The "Connect Gmail" button kicks off the OAuth flow at
 * /api/auth/google/gmail/start.
 */
import { InboxSettingsView } from "@/components/inbox-settings-view";
import { createClient } from "@/lib/supabase/server";
import type {
  EmailAccountRow,
  EmailLabelRow,
  EmailStyleOverridesRow,
  EmailVoiceProfileRow,
} from "@/lib/inbox/types";

export const dynamic = "force-dynamic";

export default async function InboxSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [
    { data: accounts },
    { data: profiles },
    { data: styles },
    { data: labels },
  ] = await Promise.all([
    supabase
      .from("email_accounts")
      .select("*")
      .eq("user_id", user.id)
      .order("email_address"),
    supabase.from("email_voice_profiles").select("*").eq("user_id", user.id),
    supabase.from("email_style_overrides").select("*").eq("user_id", user.id),
    supabase
      .from("email_labels")
      .select("*")
      .eq("user_id", user.id)
      .order("sort_order"),
  ]);

  return (
    <InboxSettingsView
      accounts={(accounts || []) as EmailAccountRow[]}
      profiles={(profiles || []) as EmailVoiceProfileRow[]}
      styles={(styles || []) as EmailStyleOverridesRow[]}
      labels={(labels || []) as EmailLabelRow[]}
    />
  );
}
