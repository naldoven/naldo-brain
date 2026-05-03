import { TasksView } from "@/components/tasks-view";
import { createClient } from "@/lib/supabase/server";

export default async function TasksPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: boards }, { data: tasks }] = await Promise.all([
    supabase
      .from("boards")
      .select("*")
      .eq("user_id", user!.id)
      .eq("archived", false)
      .order("position"),
    supabase
      .from("tasks")
      .select("*")
      .eq("user_id", user!.id)
      .neq("status", "done")
      .order("position"),
  ]);

  return <TasksView initialBoards={boards ?? []} initialTasks={tasks ?? []} />;
}
