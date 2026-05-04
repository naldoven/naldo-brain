import { CalendarView } from "@/components/calendar-view";
import { createClient } from "@/lib/supabase/server";

export default async function CalendarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Match the sync window in lib/google-calendar.ts (-30d / +365d) so every
  // synced event is reachable when the user navigates months.
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86400000).toISOString();
  const to = new Date(now.getTime() + 365 * 86400000).toISOString();

  const { data: events } = await supabase
    .from("calendar_events")
    .select("*")
    .eq("user_id", user!.id)
    .gte("starts_at", from)
    .lte("starts_at", to)
    .order("starts_at");

  return <CalendarView initialEvents={events ?? []} />;
}
