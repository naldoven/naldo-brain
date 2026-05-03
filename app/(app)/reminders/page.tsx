import { RemindersView } from "@/components/reminders-view";
import { createClient } from "@/lib/supabase/server";

export default async function RemindersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: reminders } = await supabase
    .from("reminders")
    .select("*")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false });

  return <RemindersView initialReminders={reminders ?? []} />;
}
