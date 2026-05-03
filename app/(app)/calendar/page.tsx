import { CalendarView } from "@/components/calendar-view";
import { createClient } from "@/lib/supabase/server";

export default async function CalendarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Pull events for a 3-month window centered on today
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const to = new Date(now.getFullYear(), now.getMonth() + 2, 1).toISOString();

  const { data: events } = await supabase
    .from("calendar_events")
    .select("*")
    .eq("user_id", user!.id)
    .gte("starts_at", from)
    .lte("starts_at", to)
    .order("starts_at");

  return <CalendarView initialEvents={events ?? []} />;
}
