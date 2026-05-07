import { Target } from "lucide-react";
import { DebtProgressCard } from "@/components/debt-progress-card";

export default function GoalsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Target className="size-7" /> Goals 2026
        </h1>
        <p className="text-sm text-zinc-400 mt-1">
          Where the year is going. Numbers update as data sources come online.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DebtProgressCard />
        <PendingGoal title="$500K revenue" hint="Wires up when GHL pipeline + finance module are live." />
        <PendingGoal title="5-6 permanent installs" hint="Counted from GHL pipeline tag once configured." />
        <PendingGoal title="10+ events" hint="Counted from calendar + GHL." />
        <PendingGoal title="50+ holiday homes" hint="Counted from GHL pipeline once tagged." />
        <PendingGoal title="Full-time YLL" hint="Computed from CFA → YLL income ratio when finance module is live." />
        <PendingGoal title="House savings" hint="Wires up when finance module tracks savings buckets." />
        <PendingGoal title="Ring savings" hint="Wires up when finance module tracks savings buckets." />
      </div>
    </div>
  );
}

function PendingGoal({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="glass rounded-2xl p-5 opacity-60">
      <div className="text-xs text-zinc-500 uppercase tracking-wider">Pending</div>
      <div className="text-lg font-semibold mt-1">{title}</div>
      <div className="text-xs text-zinc-500 mt-2">{hint}</div>
    </div>
  );
}
