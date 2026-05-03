"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { FloatingChat } from "@/components/floating-chat";

type Props = {
  user: { email?: string | null; name?: string | null; phone?: string | null };
  children: React.ReactNode;
};

export function AppShell({ user, children }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <AppSidebar
        user={user}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top bar — only visible on mobile */}
        <div className="md:hidden sticky top-0 z-30 glass-strong flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <button
            onClick={() => setMobileOpen(true)}
            className="size-9 rounded-lg hover:bg-white/10 flex items-center justify-center"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <div className="brand-gradient w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold">
            B
          </div>
          <span className="font-bold text-sm">naldo&apos;s brain</span>
        </div>

        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>

      <FloatingChat />
    </div>
  );
}
