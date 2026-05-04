import { IntegrationsView } from "@/components/integrations-view";
import { createClient } from "@/lib/supabase/server";

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: googleConn } = await supabase
    .from("google_connections")
    .select("integration, account_email, last_synced_at, scope, created_at")
    .eq("user_id", user!.id)
    .eq("integration", "calendar")
    .maybeSingle();

  return <IntegrationsView googleCalendar={googleConn ?? null} />;
}
