import { Sparkles } from "lucide-react";

type Props = {
  title: string;
  subtitle?: string;
  phase: string;
  description: string;
};

export function ModulePlaceholder({
  title,
  subtitle,
  phase,
  description,
}: Props) {
  return (
    <div className="max-w-3xl mx-auto pt-8">
      <div className="glass-strong rounded-2xl p-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="brand-gradient size-10 rounded-full flex items-center justify-center text-white">
            <Sparkles className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{title}</h1>
            {subtitle && (
              <p className="text-sm text-zinc-400">{subtitle}</p>
            )}
          </div>
          <span className="ml-auto text-[10px] uppercase tracking-wider px-3 py-1 bg-amber-500/20 text-amber-300 rounded-full">
            {phase}
          </span>
        </div>
        <p className="text-zinc-300 leading-relaxed">{description}</p>
        <div className="mt-6 text-xs text-zinc-500">
          Foundation phase — sidebar nav, auth, and theme are live. This module
          fills in during its build phase.
        </div>
      </div>
    </div>
  );
}
