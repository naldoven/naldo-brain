import { ChatView } from "@/components/chat-view";
import { createClient } from "@/lib/supabase/server";

export default async function ChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Pre-load history server-side
  const { data: messages } = await supabase
    .from("chat_messages")
    .select("id, role, content, channel, created_at")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: true })
    .limit(50);

  // Recent captures for right rail
  const { data: captures } = await supabase
    .from("captures")
    .select("id, title, source, category, created_at")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false })
    .limit(5);

  // Active memories for right rail
  const { data: memories } = await supabase
    .from("memories")
    .select("subject, fact")
    .eq("user_id", user!.id)
    .eq("active", true)
    .limit(8);

  return (
    <ChatView
      initialMessages={messages ?? []}
      recentCaptures={captures ?? []}
      memories={memories ?? []}
    />
  );
}
