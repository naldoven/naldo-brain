import { ListsView } from "@/components/lists-view";
import { createClient } from "@/lib/supabase/server";

export default async function ListsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: lists } = await supabase
    .from("lists")
    .select(`
      *,
      list_items (id, text, completed, position, created_at)
    `)
    .eq("user_id", user!.id)
    .eq("archived", false)
    .order("position");

  return <ListsView initialLists={lists ?? []} />;
}
