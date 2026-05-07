import { TrendingDown } from "lucide-react";
import {
  DEBT_INITIAL,
  DEBT_PAID,
  DEBT_PAID_PCT,
  DEBT_REMAINING,
  formatUSD,
} from "@/lib/finance";

/**
 * Big debt-free progress card. Goes on Goals 2026.
 */
export function DebtProgressCard() {
  return (
    <div className="glass-strong rounded-2xl p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-xs text-zinc-400 uppercase tracking-wider">
            Debt-free goal
          </div>
          <div className="text-3xl font-bold mt-1">
            {formatUSD(DEBT_REMAINING)}{" "}
            <span className="text-base font-normal text-zinc-400">remaining</span>
          </div>
        </div>
        <div className="size-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
          <TrendingDown className="size-5 text-emerald-400" />
        </div>
      </div>

      <div className="relative h-3 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full rounded-full brand-gradient"
          style={{ width: `${DEBT_PAID_PCT}%` }}
        />
      </div>

      <div className="flex items-center justify-between mt-3 text-xs text-zinc-400">
        <span>
          <span className="text-emerald-400 font-semibold">
            {formatUSD(DEBT_PAID)}
          </span>{" "}
          paid off ({DEBT_PAID_PCT.toFixed(1)}%)
        </span>
        <span className="text-zinc-500">started at {formatUSD(DEBT_INITIAL)}</span>
      </div>
    </div>
  );
}

/**
 * Compact one-liner for the sidebar.
 */
export function DebtProgressMini() {
  return (
    <div className="px-2">
      <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-1">
        <span>Debt-free</span>
        <span className="tabular-nums">
          {formatUSD(DEBT_REMAINING)} / {formatUSD(DEBT_INITIAL)}
        </span>
      </div>
      <div className="relative h-1 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full rounded-full brand-gradient"
          style={{ width: `${DEBT_PAID_PCT}%` }}
        />
      </div>
    </div>
  );
}
