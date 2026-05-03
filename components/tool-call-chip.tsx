"use client";

import Link from "next/link";
import { Bell, CheckSquare, ListChecks, Brain, AlertTriangle, Check, Calendar } from "lucide-react";
import type { ComponentType } from "react";

export type ToolCallRecord = {
  type: "tool_call";
  name: string;
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
};

type ChipMeta = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  bgClass: string;
  textClass: string;
  href?: string;
};

const CHIP_META: Record<string, ChipMeta> = {
  create_reminder: {
    label: "Reminder",
    icon: Bell,
    bgClass: "bg-pink-500/15 border-pink-500/30",
    textClass: "text-pink-300",
    href: "/reminders",
  },
  create_task: {
    label: "Task",
    icon: CheckSquare,
    bgClass: "bg-amber-500/15 border-amber-500/30",
    textClass: "text-amber-300",
    href: "/tasks",
  },
  add_to_list: {
    label: "List",
    icon: ListChecks,
    bgClass: "bg-indigo-500/15 border-indigo-500/30",
    textClass: "text-indigo-300",
    href: "/lists",
  },
  save_memory: {
    label: "Memory",
    icon: Brain,
    bgClass: "bg-purple-500/15 border-purple-500/30",
    textClass: "text-purple-300",
  },
  flag_avoidance: {
    label: "Avoidance",
    icon: AlertTriangle,
    bgClass: "bg-red-500/15 border-red-500/30",
    textClass: "text-red-300",
    href: "/avoidance",
  },
  create_event: {
    label: "Event",
    icon: Calendar,
    bgClass: "bg-green-500/15 border-green-500/30",
    textClass: "text-green-300",
    href: "/calendar",
  },
};

export function ToolCallChip({ call }: { call: ToolCallRecord }) {
  const meta = CHIP_META[call.name] ?? {
    label: call.name,
    icon: Check,
    bgClass: "bg-green-500/15 border-green-500/30",
    textClass: "text-green-300",
  };
  const Icon = meta.icon;

  const inner = (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${meta.bgClass} ${call.ok ? "" : "opacity-70"}`}
    >
      <div className={`mt-0.5 ${meta.textClass}`}>
        <Icon className="size-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {call.ok && <Check className="size-3 text-green-400" />}
          <span className={`text-xs font-bold uppercase tracking-wider ${meta.textClass}`}>
            {meta.label}
          </span>
        </div>
        <div className="text-xs text-zinc-300 mt-0.5">{call.summary}</div>
      </div>
    </div>
  );

  if (meta.href && call.ok) {
    return (
      <Link href={meta.href} className="block hover:opacity-90 transition-opacity">
        {inner}
      </Link>
    );
  }
  return inner;
}

export function isToolCallArray(value: unknown): value is ToolCallRecord[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (v) =>
        typeof v === "object" &&
        v !== null &&
        "type" in v &&
        (v as { type: unknown }).type === "tool_call"
    )
  );
}
