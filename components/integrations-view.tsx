"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Calendar, CheckCircle, XCircle, Loader2, Plug, Wallet } from "lucide-react";
import { toast } from "sonner";
import { usePlaidLink } from "react-plaid-link";

type GoogleConnection = {
  integration: string;
  account_email: string | null;
  last_synced_at: string | null;
  scope: string | null;
  created_at: string;
};

type PlaidItem = {
  id: string;
  institution_name: string | null;
  status: string;
  last_synced_at: string | null;
};

type Props = {
  googleCalendar: GoogleConnection | null;
  plaidItems: PlaidItem[];
};

export function IntegrationsView({ googleCalendar, plaidItems }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [disconnecting, setDisconnecting] = useState(false);

  // Show toast on redirect from OAuth flow
  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (connected === "google_calendar") {
      toast.success("Google Calendar connected — first sync runs in ~15 min, or trigger manually below.");
      // Clean up the URL
      const url = new URL(window.location.href);
      url.searchParams.delete("connected");
      window.history.replaceState(null, "", url.pathname);
    } else if (error) {
      toast.error(`Google Calendar: ${error}`);
      const url = new URL(window.location.href);
      url.searchParams.delete("error");
      window.history.replaceState(null, "", url.pathname);
    }
  }, [searchParams]);

  async function disconnectGoogle() {
    if (!confirm("Disconnect Google Calendar? Synced events stay on the dashboard but will no longer update.")) {
      return;
    }
    setDisconnecting(true);
    const res = await fetch("/api/auth/google/calendar/disconnect", { method: "POST" });
    setDisconnecting(false);
    if (!res.ok) {
      toast.error("Failed to disconnect");
      return;
    }
    toast.success("Disconnected");
    router.refresh();
  }

  // ---- Plaid -------------------------------------------------------------
  const [plaidLinkToken, setPlaidLinkToken] = useState<string | null>(null);
  const [plaidLoading, setPlaidLoading] = useState(false);
  const [disconnectingPlaid, setDisconnectingPlaid] = useState<string | null>(null);

  const requestPlaidLinkToken = useCallback(async () => {
    setPlaidLoading(true);
    try {
      const res = await fetch("/api/plaid/create-link-token", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(`Plaid: ${data.error ?? "couldn't start link flow"}`);
        return;
      }
      setPlaidLinkToken(data.link_token);
    } catch {
      toast.error("Couldn't reach Plaid");
    } finally {
      setPlaidLoading(false);
    }
  }, []);

  const onPlaidSuccess = useCallback(
    async (publicToken: string) => {
      const res = await fetch("/api/plaid/exchange-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_token: publicToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(`Plaid: ${data.error ?? "exchange failed"}`);
        return;
      }
      toast.success(`Connected ${data.institution_name ?? "bank"}`);
      setPlaidLinkToken(null);
      router.refresh();
    },
    [router]
  );

  const { open: openPlaid, ready: plaidReady } = usePlaidLink({
    token: plaidLinkToken,
    onSuccess: onPlaidSuccess,
    onExit: (err) => {
      if (err) toast.error(`Plaid: ${err.display_message ?? err.error_message ?? "cancelled"}`);
      setPlaidLinkToken(null);
    },
  });

  // Auto-open Plaid Link as soon as the token arrives
  useEffect(() => {
    if (plaidLinkToken && plaidReady) openPlaid();
  }, [plaidLinkToken, plaidReady, openPlaid]);

  async function disconnectPlaidItem(itemId: string, label: string) {
    if (!confirm(`Disconnect ${label}? Synced accounts + transactions will be removed.`)) {
      return;
    }
    setDisconnectingPlaid(itemId);
    const res = await fetch("/api/plaid/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: itemId }),
    });
    setDisconnectingPlaid(null);
    if (!res.ok) {
      toast.error("Failed to disconnect");
      return;
    }
    toast.success(`Disconnected ${label}`);
    router.refresh();
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Plug className="size-7" /> Integrations
        </h1>
        <p className="text-zinc-400">Connect external services to sync data automatically.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Google Calendar */}
        <div className="glass-strong rounded-2xl p-5">
          <div className="flex items-start gap-3 mb-3">
            <div className="size-10 rounded-lg bg-green-500/20 flex items-center justify-center text-green-400">
              <Calendar className="size-5" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold">Google Calendar</h3>
              <p className="text-xs text-zinc-400">
                Two-way sync with your primary Google calendar. Events you create in Brain show in Google + vice versa.
              </p>
            </div>
            {googleCalendar ? (
              <span className="badge text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-300 flex items-center gap-1">
                <CheckCircle className="size-3" /> Connected
              </span>
            ) : (
              <span className="badge text-xs px-2 py-1 rounded-full bg-zinc-500/20 text-zinc-400 flex items-center gap-1">
                <XCircle className="size-3" /> Not connected
              </span>
            )}
          </div>

          {googleCalendar && (
            <div className="bg-white/5 rounded-lg p-3 text-xs space-y-1 mb-3">
              {googleCalendar.account_email && (
                <div>
                  <span className="text-zinc-400">Account:</span>{" "}
                  <span className="font-semibold">{googleCalendar.account_email}</span>
                </div>
              )}
              <div>
                <span className="text-zinc-400">Last synced:</span>{" "}
                <span className="font-semibold">
                  {googleCalendar.last_synced_at
                    ? new Date(googleCalendar.last_synced_at).toLocaleString()
                    : "Never (waiting for next 15-min cron)"}
                </span>
              </div>
              <div>
                <span className="text-zinc-400">Scope:</span>{" "}
                <span className="text-[10px] text-zinc-500">
                  {googleCalendar.scope ?? "calendar.events"}
                </span>
              </div>
            </div>
          )}

          {googleCalendar ? (
            <button
              onClick={disconnectGoogle}
              disabled={disconnecting}
              className="w-full py-2 rounded-lg text-sm font-semibold bg-red-500/20 hover:bg-red-500/30 text-red-300 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {disconnecting && <Loader2 className="size-3.5 animate-spin" />}
              Disconnect
            </button>
          ) : (
            <a
              href="/api/auth/google/calendar/start"
              className="w-full py-2 rounded-lg text-sm font-semibold brand-gradient text-white flex items-center justify-center gap-2"
            >
              <Plug className="size-4" /> Connect Google Calendar
            </a>
          )}
        </div>

        {/* Plaid (banking) */}
        <div className="glass-strong rounded-2xl p-5">
          <div className="flex items-start gap-3 mb-3">
            <div className="size-10 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Wallet className="size-5" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold">Bank accounts (Plaid)</h3>
              <p className="text-xs text-zinc-400">
                Connect bank, credit, and loan accounts. Powers the /finance
                page, debt-payoff tracker, and 30-day cash flow in briefings.
              </p>
            </div>
            {plaidItems.length > 0 ? (
              <span className="badge text-xs px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center gap-1">
                <CheckCircle className="size-3" /> {plaidItems.length} connected
              </span>
            ) : (
              <span className="badge text-xs px-2 py-1 rounded-full bg-zinc-500/20 text-zinc-400 flex items-center gap-1">
                <XCircle className="size-3" /> Not connected
              </span>
            )}
          </div>

          {plaidItems.length > 0 && (
            <div className="space-y-2 mb-3">
              {plaidItems.map((it) => (
                <div
                  key={it.id}
                  className="bg-white/5 rounded-lg p-3 text-xs flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-semibold truncate">
                      {it.institution_name ?? "Bank connection"}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      status: {it.status}
                      {it.last_synced_at
                        ? ` · last sync ${new Date(it.last_synced_at).toLocaleString()}`
                        : " · never synced"}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      disconnectPlaidItem(it.id, it.institution_name ?? "this connection")
                    }
                    disabled={disconnectingPlaid === it.id}
                    className="text-[11px] px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 disabled:opacity-50 flex items-center gap-1 shrink-0"
                  >
                    {disconnectingPlaid === it.id && (
                      <Loader2 className="size-3 animate-spin" />
                    )}
                    Disconnect
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={requestPlaidLinkToken}
            disabled={plaidLoading || (plaidLinkToken !== null && !plaidReady)}
            className="w-full py-2 rounded-lg text-sm font-semibold brand-gradient text-white flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {(plaidLoading || (plaidLinkToken !== null && !plaidReady)) && (
              <Loader2 className="size-3.5 animate-spin" />
            )}
            <Plug className="size-4" />{" "}
            {plaidItems.length > 0 ? "Connect another account" : "Connect a bank account"}
          </button>
        </div>
      </div>
    </div>
  );
}
