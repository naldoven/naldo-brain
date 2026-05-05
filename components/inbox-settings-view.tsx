"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  Settings as SettingsIcon,
  Mail,
  Inbox,
  History,
  Plus,
  Trash2,
  Loader2,
  Check,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import type {
  DefaultAction,
  EmailAccountRow,
  EmailLabelRow,
  EmailStyleOverridesRow,
  EmailVoiceProfileRow,
} from "@/lib/inbox/types";

type Props = {
  accounts: EmailAccountRow[];
  profiles: EmailVoiceProfileRow[];
  styles: EmailStyleOverridesRow[];
  labels: EmailLabelRow[];
};

const ACTION_LABELS: Record<DefaultAction, { title: string; help: string }> = {
  archive_only: {
    title: "Archive immediately",
    help: "Apply label, remove from inbox right away. Recoverable from /inbox/audit.",
  },
  trash_only: {
    title: "Trash immediately",
    help: "Apply label and move to Gmail Trash. Auto-deletes after 30 days. Most aggressive — only for unambiguous spam.",
  },
  archive_after_24h: {
    title: "Archive after 24 hours",
    help: "Off the dashboard immediately, stays in Gmail INBOX for 24 hours, then auto-archives.",
  },
  trash_after_24h: {
    title: "Trash after 24 hours",
    help: "Off the dashboard immediately, stays in Gmail INBOX for 24 hours, then auto-trashes.",
  },
  keep_in_inbox: {
    title: "Keep in inbox (silent)",
    help: "Apply label, leave in Gmail inbox forever, don't surface to dashboard. Like a quiet tag.",
  },
  surface_no_draft: {
    title: "Surface without draft",
    help: "Apply label, leave in inbox, show in dashboard for review. No reply drafted.",
  },
  surface_with_draft: {
    title: "Surface and draft reply",
    help: "Apply label, leave in inbox, show in dashboard, draft a reply in your voice.",
  },
};

export function InboxSettingsView({ accounts, profiles, styles, labels }: Props) {
  const profileMap = new Map(profiles.map((p) => [p.account_id, p]));
  const styleMap = new Map(styles.map((s) => [s.account_id, s]));
  const labelsByAccount = new Map<string, EmailLabelRow[]>();
  for (const l of labels) {
    const arr = labelsByAccount.get(l.account_id) ?? [];
    arr.push(l);
    labelsByAccount.set(l.account_id, arr);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <SettingsIcon className="size-7" /> Inbox Settings
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Voice training, labels, and connected accounts.
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
            href="/inbox/audit"
            className="glass rounded-full px-4 py-2 text-sm flex items-center gap-2 hover:bg-white/5 transition"
          >
            <History className="size-4" /> Audit
          </Link>
        </div>
      </div>

      <div className="mb-6">
        <a
          href="/api/auth/google/gmail/start"
          className="brand-gradient rounded-full px-5 py-2 text-white font-semibold text-sm inline-flex items-center gap-2"
        >
          <Mail className="size-4" /> Connect another Gmail account
        </a>
      </div>

      {accounts.length === 0 ? (
        <div className="glass-strong rounded-2xl p-8 text-center">
          <Mail className="size-12 mx-auto text-zinc-600 mb-3" />
          <h3 className="font-bold mb-1">No accounts connected yet</h3>
          <p className="text-xs text-zinc-500">
            Click &quot;Connect another Gmail account&quot; above to authorize one.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {accounts.map((acc) => (
            <AccountSection
              key={acc.id}
              account={acc}
              voiceProfile={profileMap.get(acc.id) ?? null}
              styleOverrides={styleMap.get(acc.id) ?? null}
              initialLabels={labelsByAccount.get(acc.id) ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AccountSection({
  account,
  voiceProfile,
  styleOverrides,
  initialLabels,
}: {
  account: EmailAccountRow;
  voiceProfile: EmailVoiceProfileRow | null;
  styleOverrides: EmailStyleOverridesRow | null;
  initialLabels: EmailLabelRow[];
}) {
  return (
    <section className="glass-strong rounded-2xl">
      <header className="px-5 py-3 border-b border-white/10 flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="font-semibold flex items-center gap-2">
            <Mail className="size-4 text-zinc-400" />
            {account.email_address}
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">
            {account.is_active ? "Active" : "Disabled"} · last polled{" "}
            {new Date(account.last_polled_at).toLocaleString()}
          </div>
        </div>
        {!voiceProfile && (
          <span className="text-xs px-2 py-1 rounded-full bg-amber-500/20 text-amber-300">
            no voice profile
          </span>
        )}
      </header>

      <div className="px-5 py-4">
        <details className="mb-4">
          <summary className="cursor-pointer text-sm font-medium text-zinc-400 hover:text-white">
            Voice profile
            {voiceProfile && ` · ${voiceProfile.source_email_count} samples`}
          </summary>
          <pre className="mt-2 text-sm whitespace-pre-wrap font-sans bg-white/5 rounded-lg p-3 leading-relaxed">
            {voiceProfile?.profile_text ||
              "Not generated yet. Run the build-voice-profile script with --account=" +
                account.email_address +
                " to create one."}
          </pre>
        </details>

        <SettingsForm
          accountId={account.id}
          initialStyleGuide={styleOverrides?.style_guide || ""}
          initialFavoriteEmails={styleOverrides?.favorite_emails || ""}
          initialHardRules={styleOverrides?.hard_rules || ""}
        />

        <div className="mt-6 pt-6 border-t border-white/10">
          <LabelsManager accountId={account.id} initialLabels={initialLabels} />
        </div>
      </div>
    </section>
  );
}

function SettingsForm({
  accountId,
  initialStyleGuide,
  initialFavoriteEmails,
  initialHardRules,
}: {
  accountId: string;
  initialStyleGuide: string;
  initialFavoriteEmails: string;
  initialHardRules: string;
}) {
  const [styleGuide, setStyleGuide] = useState(initialStyleGuide);
  const [favoriteEmails, setFavoriteEmails] = useState(initialFavoriteEmails);
  const [hardRules, setHardRules] = useState(initialHardRules);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/inbox/settings/style", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          style_guide: styleGuide,
          favorite_emails: favoriteEmails,
          hard_rules: hardRules,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "save failed");
      } else {
        toast.success("Saved");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field
        label="Style guide"
        hint="5–10 sentences on tone, formality, signoffs, things you always or never do."
        value={styleGuide}
        onChange={setStyleGuide}
        rows={6}
      />
      <Field
        label="Favorite emails"
        hint="Paste 3–5 emails you've sent that nail your voice. Separate with --- on its own line."
        value={favoriteEmails}
        onChange={setFavoriteEmails}
        rows={10}
      />
      <Field
        label="Hard rules"
        hint='Things the agent must NEVER do, e.g. "never quote prices to customers", "always sign as Naldo on personal mail".'
        value={hardRules}
        onChange={setHardRules}
        rows={5}
      />
      <button
        type="submit"
        disabled={saving}
        className="brand-gradient rounded-full px-5 py-2 text-white font-semibold text-sm disabled:opacity-50 inline-flex items-center gap-1.5"
      >
        {saving && <Loader2 className="size-3.5 animate-spin" />}
        {saving ? "Saving" : "Save voice training"}
      </button>
    </form>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  rows,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (s: string) => void;
  rows: number;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <p className="text-xs text-zinc-500 mb-2">{hint}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 font-mono text-sm leading-relaxed focus:outline-none focus:border-indigo-500"
      />
    </div>
  );
}

function LabelsManager({
  accountId,
  initialLabels,
}: {
  accountId: string;
  initialLabels: EmailLabelRow[];
}) {
  const [labels, setLabels] = useState<EmailLabelRow[]>(initialLabels);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [defaultAction, setDefaultAction] =
    useState<DefaultAction>("surface_no_draft");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await fetch(`/api/inbox/labels?account_id=${accountId}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "failed to load labels");
        return;
      }
      setLabels(data.labels);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/inbox/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          name: name.trim(),
          description: description.trim(),
          default_action: defaultAction,
          sort_order: labels.length,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "create failed");
        return;
      }
      toast.success(`Label "${name}" created in Gmail`);
      setName("");
      setDescription("");
      setAdding(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (
      !confirm(
        "Delete this label? Existing emails labeled with it keep their Gmail label, but the rule disappears from this dashboard.",
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/inbox/labels/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "delete failed");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function update(
    id: string,
    patch: Partial<Pick<EmailLabelRow, "default_action" | "description">>,
  ) {
    setBusy(true);
    try {
      const res = await fetch(`/api/inbox/labels/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "update failed");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
          <Tag className="size-3.5" />
          Labels{labels.length > 0 && ` (${labels.length})`}
        </h3>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-xs rounded-full px-3 py-1 hover:bg-white/5 flex items-center gap-1.5"
          >
            <Plus className="size-3" /> Add label
          </button>
        )}
      </div>

      {adding && (
        <form
          onSubmit={add}
          className="border border-indigo-500/40 rounded-lg p-3 mb-3 bg-white/5 space-y-2"
        >
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Customer Lead"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Description (helps Claude know what fits)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. New customer inquiries asking for a quote, install, or estimate"
              rows={2}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Default action</label>
            <select
              value={defaultAction}
              onChange={(e) => setDefaultAction(e.target.value as DefaultAction)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none cursor-pointer"
            >
              {(Object.keys(ACTION_LABELS) as DefaultAction[]).map((a) => (
                <option key={a} value={a} className="bg-zinc-900">
                  {ACTION_LABELS[a].title}
                </option>
              ))}
            </select>
            <p className="text-xs text-zinc-500 mt-1">
              {ACTION_LABELS[defaultAction].help}
            </p>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="brand-gradient rounded-full px-4 py-1.5 text-white font-semibold text-sm disabled:opacity-50 flex items-center gap-1.5"
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {busy ? "Creating" : "Create label"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setName("");
                setDescription("");
              }}
              className="rounded-full px-4 py-1.5 text-sm hover:bg-white/5"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {labels.length === 0 && !adding && (
        <p className="text-xs text-zinc-500 py-2">
          No labels yet. The agent uses default archive/surface logic until you add at least one.
        </p>
      )}

      <div className="space-y-2">
        {labels.map((label) => (
          <div
            key={label.id}
            className="rounded-lg p-3 bg-white/5 border border-white/10"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-medium">{label.name}</div>
                {label.description && (
                  <div className="text-xs text-zinc-400 mt-0.5">{label.description}</div>
                )}
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <select
                    value={label.default_action}
                    onChange={(e) =>
                      update(label.id, {
                        default_action: e.target.value as DefaultAction,
                      })
                    }
                    disabled={busy}
                    className="bg-white/5 border border-white/10 rounded-full px-3 py-0.5 text-xs focus:outline-none cursor-pointer"
                  >
                    {(Object.keys(ACTION_LABELS) as DefaultAction[]).map((a) => (
                      <option key={a} value={a} className="bg-zinc-900">
                        {ACTION_LABELS[a].title}
                      </option>
                    ))}
                  </select>
                  {label.gmail_label_id ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 flex items-center gap-1">
                      <Check className="size-2.5" /> synced
                    </span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
                      not synced
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(label.id)}
                disabled={busy}
                className="text-xs rounded-full px-2 py-1 hover:bg-red-500/20 hover:text-red-300 disabled:opacity-50 flex items-center gap-1"
              >
                <Trash2 className="size-3" />
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
