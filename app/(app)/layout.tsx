import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/app-sidebar";
import { FloatingChat } from "@/components/floating-chat";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const profile = {
    email: user.email,
    name: user.user_metadata?.full_name || null,
    phone: user.phone || null,
  };

  return (
    <div className="flex min-h-screen">
      <AppSidebar user={profile} />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
      <FloatingChat />
    </div>
  );
}
