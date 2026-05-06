import { IntegrationsView } from "@/components/integrations-view";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [googleRes, plaidRes] = await Promise.all([
    supabase
      .from("google_connections")
      .select("integration, account_email, last_synced_at, scope, created_at")
      .eq("user_id", user!.id)
      .eq("integration", "calendar")
      .maybeSingle(),
    supabase
      .from("plaid_items")
      .select("id, institution_name, status, last_synced_at")
      .eq("user_id", user!.id)
      .order("created_at"),
  ]);

  return (
    <IntegrationsView
      googleCalendar={googleRes.data ?? null}
      plaidItems={plaidRes.data ?? []}
    />
  );
}
