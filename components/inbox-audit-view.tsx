"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  History,
  Inbox,
  Settings as SettingsIcon,
  Search,
  Undo2,
  AlertTriangle,
  Check,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import type {
  EmailAccountRow,
  EmailArchiveAuditRow,
  EmailMessageRow,
} from "@/lib/inbox/types";

type Props = {
  audits: EmailArchiveAuditRow[];
  messages: EmailMessageRow[];
  accounts: EmailAccountRow[];
};

export function InboxAuditView({ audits, messages, accounts }: Props) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState(
    audits.map((a) => ({
      audit: a,
      message: messages.find((m) => m.id === a.message_id) || null,
    })),
  );

  const accountMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(({ message }) => {
      if (!message) return false;
      return (
        message.from_address.toLowerCase().includes(q) ||
        (message.from_name?.toLowerCase().includes(q) ?? false) ||
        (message.subject?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [rows, search]);

  function patchAudit(id: string, patch: Partial<EmailArchiveAuditRow>) {
    setRows((rs) =>
      rs.map((r) =>
        r.audit.message_id === id ? { ...r, audit: { ...r.audit, ...patch } } : r,
      ),
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <History className="size-7" /> Audit
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Last 30 days · {audits.length} archive{audits.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/inbox"
            className="glass rounded-full px-4 py-2 text-sm flex items-center gap-2 hover:bg-white/5 transition"
          >
            <Inbox className="size-4" /> Inbox
          </Link>
          <Link
            href="/inbox/settings"
            className="glass rounded-full px-4 py-2 text-sm flex items-center gap-2 hover:bg-white/5 transition"
          >
            <SettingsIcon className="size-4" /> Settings
          </Link>
        </div>
      </div>

      {audits.length > 0 && (
        <div className="glass rounded-full flex items-center px-4 py-2 mb-4">
          <Search className="size-4 text-zinc-500 mr-2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by sender or subject"
            className="bg-transparent flex-1 text-sm placeholder-zinc-500 focus:outline-none"
          />
        </div>
      )}

      {audits.length === 0 ? (
        <div className="glass-strong rounded-2xl py-16 text-center text-zinc-400">
          No archives in the last 30 days.
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(({ audit, message }) => {
            if (!message) return null;
            const acc = accountMap.get(message.account_id);
            return (
              <AuditRow
                key={audit.message_id}
                audit={audit}
                message={message}
                accountLabel={acc?.display_label || acc?.email_address || "?"}
                onPatch={(patch) => patchAudit(audit.message_id, patch)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function AuditRow({
  audit,
  message,
  accountLabel,
  onPatch,
}: {
  audit: EmailArchiveAuditRow;
  message: EmailMessageRow;
  accountLabel: string;
  onPatch: (patch: Partial<EmailArchiveAuditRow>) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function unarchive() {
    setBusy("unarchive");
    try {
      const res = await fetch(`/api/inbox/audit/${audit.message_id}/unarchive`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "un-archive failed");
        return;
      }
      onPatch({ unarchived_at: new Date().toISOString() });
      toast.success("Restored to inbox");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function markWrong() {
    setBusy("mark-wrong");
    try {
      const res = await fetch(`/api/inbox/audit/${audit.message_id}/mark-wrong`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "mark-wrong failed");
        return;
      }
      onPatch({ marked_wrong_at: new Date().toISOString() });
      toast.success("Flagged");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const time = new Date(audit.archived_at);
  const timeStr = time.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <article className="glass rounded-xl px-4 py-3">
      <div className="flex items-baseline gap-2 mb-1 flex-wrap">
        <div className="font-medium truncate max-w-[40ch]">
          {message.from_name || message.from_address}
        </div>
        <div className="text-xs text-zinc-500">{message.from_address}</div>
        <div className="ml-auto text-xs text-zinc-400 tabular-nums whitespace-nowrap">
          {timeStr} · {accountLabel}
        </div>
      </div>
      <div className="text-sm mb-1 truncate">{message.subject || "(no subject)"}</div>
      <div className="text-xs text-zinc-400 mb-2 line-clamp-1">{message.snippet}</div>
      <div className="text-xs text-zinc-500 mb-2">
        <span className="text-amber-400">AI:</span> {message.reason} ·{" "}
        <span className="tabular-nums">{(message.confidence * 100).toFixed(0)}%</span>
      </div>
      <div className="flex gap-2 flex-wrap">
        {audit.unarchived_at ? (
          <span className="text-xs text-green-400 flex items-center gap-1">
            <Check className="size-3" /> Un-archived
          </span>
        ) : (
          <button
            onClick={unarchive}
            disabled={!!busy}
            className="text-xs rounded-full px-3 py-1 hover:bg-white/5 disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy === "unarchive" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Undo2 className="size-3" />
            )}
            Un-archive
          </button>
        )}
        {audit.marked_wrong_at ? (
          <span className="text-xs text-amber-400 flex items-center gap-1">
            <AlertTriangle className="size-3" /> Flagged
          </span>
        ) : (
          <button
            onClick={markWrong}
            disabled={!!busy}
            className="text-xs rounded-full px-3 py-1 hover:bg-white/5 disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy === "mark-wrong" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <AlertTriangle className="size-3" />
            )}
            Mark wrong
          </button>
        )}
      </div>
    </article>
  );
}
