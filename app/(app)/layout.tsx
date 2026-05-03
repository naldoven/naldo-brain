import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";

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

  return <AppShell user={profile}>{children}</AppShell>;
}
