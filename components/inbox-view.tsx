"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Inbox,
  Loader2,
  Pencil,
  Check,
  X,
  Trash2,
  Ban,
  Tag,
  CheckCheck,
  History,
  Settings as SettingsIcon,
} from "lucide-react";
import { toast } from "sonner";
import type {
  EmailAccountRow,
  EmailLabelRow,
  EmailMessageRow,
} from "@/lib/inbox/types";

type Props = {
  messages: EmailMessageRow[];
  accounts: EmailAccountRow[];
  labels: EmailLabelRow[];
};

export function InboxView({ messages, accounts, labels }: Props) {
  const [list, setList] = useState<EmailMessageRow[]>(messages);

  const accountMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );
  const labelsByAccount = useMemo(() => {
    const m = new Map<string, EmailLabelRow[]>();
    for (const l of labels) {
      const arr = m.get(l.account_id) ?? [];
      arr.push(l);
      m.set(l.account_id, arr);
    }
    return m;
  }, [labels]);

  function removeFromList(id: string) {
    setList((xs) => xs.filter((x) => x.id !== id));
  }

  function patchInList(id: string, patch: Partial<EmailMessageRow>) {
    setList((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Inbox className="size-7" /> Inbox
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            {list.length === 0
              ? "All caught up — agent surfaces new mail every 10 minutes."
              : `${list.length} ${list.length === 1 ? "item" : "items"} need you`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/inbox/audit"
            className="glass rounded-full px-4 py-2 text-sm flex items-center gap-2 hover:bg-white/5 transition"
          >
            <History className="size-4" /> Audit
          </Link>
          <Link
            href="/inbox/settings"
            className="glass rounded-full px-4 py-2 text-sm flex items-center gap-2 hover:bg-white/5 transition"
          >
            <SettingsIcon className="size-4" /> Settings
          </Link>
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState hasAccounts={accounts.length > 0} />
      ) : (
        <div className="space-y-3">
          {list.map((m) => {
            const acc = accountMap.get(m.account_id);
            return (
              <MessageCard
                key={m.id}
                message={m}
                accountLabel={acc?.display_label || acc?.email_address || "?"}
                availableLabels={labelsByAccount.get(m.account_id) ?? []}
                onHide={() => removeFromList(m.id)}
                onPatch={(patch) => patchInList(m.id, patch)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState({ hasAccounts }: { hasAccounts: boolean }) {
  return (
    <div className="glass-strong rounded-2xl py-16 text-center">
      <Inbox className="size-12 mx-auto text-zinc-600 mb-3" />
      <h3 className="font-bold mb-1">All clear</h3>
      <p className="text-xs text-zinc-500 max-w-sm mx-auto">
        {hasAccounts ? (
          <>
            Pending items will appear here. Check{" "}
            <Link href="/inbox/audit" className="underline">
              audit
            </Link>{" "}
            to see what got archived.
          </>
        ) : (
          <>
            No Gmail accounts connected yet. Head to{" "}
            <Link href="/inbox/settings" className="underline">
              settings
            </Link>{" "}
            to connect one.
          </>
        )}
      </p>
    </div>
  );
}

function MessageCard({
  message,
  accountLabel,
  availableLabels,
  onHide,
  onPatch,
}: {
  message: EmailMessageRow;
  accountLabel: string;
  availableLabels: EmailLabelRow[];
  onHide: () => void;
  onPatch: (patch: Partial<EmailMessageRow>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftSubject, setDraftSubject] = useState(message.draft_subject || "");
  const [draftBody, setDraftBody] = useState(message.draft_body || "");
  const [busy, setBusy] = useState<string | null>(null);

  const hasDraft = !!message.gmail_draft_id && message.reply_needed;
  const fromDomain = message.from_address.split("@")[1] || message.from_address;

  async function call(action: string, body?: object): Promise<unknown | null> {
    setBusy(action);
    try {
      const res = await fetch(`/api/inbox/drafts/${message.id}/${action}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `${action} failed`);
        return null;
      }
      return data;
    } catch (err) {
      toast.error((err as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (await call("approve")) {
      toast.success("Approved — open Gmail Drafts to send");
      onHide();
    }
  }
  async function reject() {
    if (await call("reject")) {
      toast.success("Draft rejected");
      onHide();
    }
  }
  async function dismiss() {
    if (await call("dismiss")) onHide();
  }
  async function confirmAi() {
    if (await call("confirm")) {
      toast.success("AI confirmed — action applied");
      onHide();
    }
  }
  async function saveEdit() {
    if (await call("edit", { draft_subject: draftSubject, draft_body: draftBody })) {
      toast.success("Draft updated in Gmail");
      onPatch({ draft_subject: draftSubject, draft_body: draftBody });
      setEditing(false);
    }
  }
  async function trashEmail() {
    if (
      !confirm(
        "Move this email to Gmail Trash? Auto-deletes in 30 days, but you can restore from Gmail Trash.",
      )
    )
      return;
    if (await call("trash")) {
      toast.success("Trashed");
      onHide();
    }
  }
  async function unsubscribeAndTrash() {
    if (
      !confirm(
        `This will:\n\n1. Try to unsubscribe from this sender's mailing list\n2. Move this email to Gmail Trash\n3. Auto-trash every future email from @${fromDomain}\n\nProceed?`,
      )
    )
      return;
    const data = (await call("unsubscribe-trash")) as
      | { unsubscribe?: { method?: string; fallbackUrl?: string } }
      | null;
    if (!data) return;
    if (data.unsubscribe?.method === "manual_url" && data.unsubscribe.fallbackUrl) {
      window.open(data.unsubscribe.fallbackUrl, "_blank", "noopener");
    }
    toast.success("Trashed + sender blocked");
    onHide();
  }
  async function alwaysArchiveFromSender() {
    if (
      !confirm(
        `Auto-archive every future email from @${fromDomain} (no AI review)? This message also archives now.\n\nUndo any time in /inbox/settings.`,
      )
    )
      return;
    setBusy("rule-archive");
    try {
      const res = await fetch("/api/inbox/sender-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: message.account_id,
          sender_pattern: fromDomain,
          pattern_type: "domain",
          action: "archive",
          reason: `auto-added from "${message.subject || "(no subject)"}"`,
          also_archive_message_id: message.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "rule creation failed");
        return;
      }
      toast.success(`Auto-archive rule added for @${fromDomain}`);
      onHide();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function changeLabel(newLabelId: string | null) {
    setBusy("label");
    try {
      const res = await fetch(`/api/inbox/drafts/${message.id}/label`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label_id: newLabelId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "label change failed");
        return;
      }
      onPatch({ label_id: newLabelId });
      if (data.status && data.status !== "pending") {
        onHide();
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const time = new Date(message.received_at);
  const timeStr = time.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <article className="glass-strong rounded-2xl p-5 hover:bg-white/[0.07] transition">
      <header className="flex items-baseline gap-3 mb-2 flex-wrap">
        <div className="font-semibold text-white truncate max-w-[40ch]">
          {message.from_name || message.from_address}
        </div>
        {message.from_name && (
          <div className="text-xs text-zinc-500 truncate">{message.from_address}</div>
        )}
        <div className="ml-auto text-xs text-zinc-400 tabular-nums whitespace-nowrap">
          {timeStr} · {accountLabel}
        </div>
      </header>

      <h3 className="text-base font-medium mb-1 leading-snug">
        {message.subject || "(no subject)"}
      </h3>
      <p className="text-sm text-zinc-400 mb-3 line-clamp-2">{message.snippet}</p>

      <div className="text-xs text-zinc-500 mb-3 flex items-center gap-3 flex-wrap">
        <span>
          <span className="text-amber-400">AI:</span> {message.reason}
        </span>
        <span className="px-1.5 py-0.5 rounded bg-white/5 tabular-nums">
          conf {(message.confidence * 100).toFixed(0)}%
        </span>
        {message.blocked_by_rule && (
          <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
            safety: {message.blocked_by_rule}
          </span>
        )}
      </div>

      {hasDraft && !editing && (
        <details className="rounded-lg bg-white/5 mb-3">
          <summary className="px-3 py-2 cursor-pointer text-sm font-medium hover:bg-white/5 rounded-lg">
            Draft reply ({message.draft_subject || "(no subject)"})
          </summary>
          <div className="px-3 py-2 border-t border-white/10 text-sm font-mono whitespace-pre-wrap leading-relaxed">
            {message.draft_body}
          </div>
        </details>
      )}

      {editing && (
        <div className="border border-indigo-500/40 rounded-lg p-3 mb-3 bg-white/5">
          <label className="text-xs text-zinc-400">Subject</label>
          <input
            value={draftSubject}
            onChange={(e) => setDraftSubject(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 mb-2 text-sm focus:outline-none focus:border-indigo-500"
          />
          <label className="text-xs text-zinc-400">Body</label>
          <textarea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            rows={10}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 font-mono text-sm leading-relaxed focus:outline-none focus:border-indigo-500"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={saveEdit}
              disabled={busy === "edit"}
              className="brand-gradient rounded-full px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50 flex items-center gap-1.5"
            >
              {busy === "edit" && <Loader2 className="size-3.5 animate-spin" />}
              {busy === "edit" ? "Saving" : "Save edit"}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-full px-4 py-1.5 text-sm hover:bg-white/5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {availableLabels.length > 0 && (
        <div className="flex items-center gap-2 mb-3 text-xs">
          <Tag className="size-3.5 text-zinc-400" />
          <span className="text-zinc-400">Label:</span>
          <select
            value={message.label_id ?? ""}
            onChange={(e) => changeLabel(e.target.value || null)}
            disabled={busy === "label"}
            className="bg-white/5 border border-white/10 rounded-full px-3 py-0.5 text-xs focus:outline-none cursor-pointer"
          >
            <option value="" className="bg-zinc-900">
              (no label)
            </option>
            {availableLabels.map((l) => (
              <option key={l.id} value={l.id} className="bg-zinc-900">
                {l.name}
              </option>
            ))}
          </select>
          {busy === "label" && (
            <Loader2 className="size-3 animate-spin text-zinc-500" />
          )}
        </div>
      )}

      <footer className="flex gap-2 flex-wrap items-center">
        {!hasDraft && (
          <button
            onClick={confirmAi}
            disabled={!!busy}
            title="The AI got this right — apply the label's action and remove from dashboard"
            className="rounded-full px-3 py-1.5 text-sm font-semibold bg-green-500/20 text-green-300 hover:bg-green-500/30 disabled:opacity-50 flex items-center gap-1.5"
          >
            <CheckCheck className="size-3.5" />
            {busy === "confirm" ? "…" : "Confirm AI"}
          </button>
        )}
        {hasDraft && (
          <>
            <button
              onClick={approve}
              disabled={!!busy}
              className="brand-gradient rounded-full px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50 flex items-center gap-1.5"
            >
              <Check className="size-3.5" />
              {busy === "approve" ? "Approving" : "Approve & open"}
            </button>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                disabled={!!busy}
                className="rounded-full px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-50 flex items-center gap-1.5"
              >
                <Pencil className="size-3.5" /> Edit
              </button>
            )}
            <button
              onClick={reject}
              disabled={!!busy}
              className="rounded-full px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-50 flex items-center gap-1.5"
            >
              <X className="size-3.5" />
              {busy === "reject" ? "…" : "Reject draft"}
            </button>
          </>
        )}
        <button
          onClick={dismiss}
          disabled={!!busy}
          className="rounded-full px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-50 ml-auto"
        >
          {busy === "dismiss" ? "…" : "Handle in Gmail"}
        </button>
        <button
          onClick={alwaysArchiveFromSender}
          disabled={!!busy}
          title={`Archive every future email from @${fromDomain}`}
          className="rounded-full px-3 py-1.5 text-sm hover:bg-amber-500/20 hover:text-amber-300 disabled:opacity-50"
        >
          {busy === "rule-archive" ? "…" : `Always archive @${fromDomain}`}
        </button>
        <button
          onClick={trashEmail}
          disabled={!!busy}
          title="Move this email to Gmail Trash"
          className="rounded-full px-3 py-1.5 text-sm hover:bg-red-500/20 hover:text-red-300 disabled:opacity-50 flex items-center gap-1.5"
        >
          <Trash2 className="size-3.5" />
          {busy === "trash" ? "…" : "Trash"}
        </button>
        <button
          onClick={unsubscribeAndTrash}
          disabled={!!busy}
          title={`Unsubscribe + auto-trash every future email from @${fromDomain}`}
          className="rounded-full px-3 py-1.5 text-sm bg-red-500/20 text-red-300 hover:bg-red-500/30 disabled:opacity-50 flex items-center gap-1.5 font-semibold"
        >
          <Ban className="size-3.5" />
          {busy === "unsubscribe-trash" ? "…" : "Unsubscribe + block"}
        </button>
      </footer>
    </article>
  );
}
