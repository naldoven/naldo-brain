"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Target,
  Briefcase,
  Wallet,
  HeartPulse,
  Users,
  AlertTriangle,
  MessageCircle,
  Bell,
  Calendar,
  ListChecks,
  CheckSquare,
  Sparkles,
  Plug,
  Inbox,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DebtProgressMini } from "@/components/debt-progress-card";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
};

const topGroup: NavItem[] = [
  { href: "/overview", label: "Overview", icon: Home },
  { href: "/goals", label: "Goals 2026", icon: Target },
  { href: "/business", label: "Business", icon: Briefcase },
  { href: "/finance", label: "Finance", icon: Wallet },
  { href: "/health", label: "Health", icon: HeartPulse },
  { href: "/team", label: "Team", icon: Users },
  { href: "/avoidance", label: "Avoidance Radar", icon: AlertTriangle },
];

const dailyGroup: NavItem[] = [
  { href: "/chat", label: "Chat with Brain", icon: MessageCircle },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/reminders", label: "Reminders", icon: Bell },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/lists", label: "Lists", icon: ListChecks },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/integrations", label: "Integrations", icon: Plug },
];

type AppSidebarProps = {
  user: { email?: string | null; name?: string | null; phone?: string | null };
  mobileOpen: boolean;
  onMobileClose: () => void;
};

export function AppSidebar({ user, mobileOpen, onMobileClose }: AppSidebarProps) {
  const pathname = usePathname();
  const initial = (user.name || user.email || "N").slice(0, 1).toUpperCase();

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={onMobileClose}
        />
      )}

      {/* Sidebar — desktop sticky / mobile slide-in */}
      <aside
        className={cn(
          "glass-strong w-64 flex flex-col p-4",
          // Desktop: sticky in flow
          "md:sticky md:top-0 md:h-screen md:translate-x-0",
          // Mobile: fixed, slide-in
          "fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out h-screen",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        {/* Mobile close button */}
        <button
          onClick={onMobileClose}
          className="md:hidden absolute top-3 right-3 size-8 rounded-full hover:bg-white/10 flex items-center justify-center text-zinc-400"
          aria-label="Close sidebar"
        >
          <X className="size-4" />
        </button>

        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 px-2">
          <div className="brand-gradient w-9 h-9 rounded-full flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/40">
            <Sparkles className="size-4" />
          </div>
          <div>
            <div className="font-bold text-white text-sm">naldo&apos;s brain</div>
            <div className="text-[10px] text-zinc-400">Life Dashboard</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto">
          {topGroup.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              pathname={pathname}
              onClick={onMobileClose}
            />
          ))}

          <div className="text-[10px] uppercase text-zinc-500 px-3 pt-4 pb-1 tracking-wider">
            Daily Use
          </div>

          {dailyGroup.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              pathname={pathname}
              onClick={onMobileClose}
            />
          ))}
        </nav>

        {/* Profile */}
        <div className="mt-auto pt-4 border-t border-white/10">
          <div className="flex items-center gap-3 p-2">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-red-500 flex items-center justify-center font-bold text-sm text-white">
              {initial}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">
                {user.name || user.email?.split("@")[0] || "User"}
              </div>
              <div className="text-[10px] text-zinc-400 truncate">
                {user.phone || user.email || ""}
              </div>
            </div>
          </div>
          <div className="mt-3">
            <DebtProgressMini />
          </div>
          <div className="text-[10px] text-zinc-500 px-2 mt-2">
            Debt free. House. Ring. 🎄
          </div>
        </div>
      </aside>
    </>
  );
}

function NavLink({
  item,
  pathname,
  onClick,
}: {
  item: NavItem;
  pathname: string | null;
  onClick: () => void;
}) {
  const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
        isActive
          ? "bg-gradient-to-r from-indigo-500/30 to-pink-500/20 border-l-2 border-amber-400 text-white"
          : "text-zinc-300 hover:bg-white/5 hover:text-white"
      )}
    >
      <Icon className="size-4" />
      <span className="flex-1">{item.label}</span>
      {item.badge && (
        <span className="brand-gradient text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
          {item.badge}
        </span>
      )}
    </Link>
  );
}
