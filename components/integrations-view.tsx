"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Calendar,
  CheckCircle,
  XCircle,
  Loader2,
  Plug,
  Wallet,
  Briefcase,
  RefreshCw,
} from "lucide-react";
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
  scope: "personal" | "business";
};

type GhlState = {
  configured: boolean;
  opportunityCount: number;
  lastSyncedAt: string | null;
};

type HealthState = {
  configured: boolean;
  totalSamples: number;
  lastReceivedAt: string | null;
  byType: Array<{ metric_type: string; count_7d: number; latest: string }>;
};

type Props = {
  googleCalendar: GoogleConnection | null;
  plaidItems: PlaidItem[];
  ghl: GhlState;
  health: HealthState;
};

type SyncKind = "google_calendar" | "ghl" | "plaid";

export function IntegrationsView({
  googleCalendar,
  plaidItems,
  ghl,
  health,
}: Props) {
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

  // ---- Sync now (shared) -------------------------------------------------
  const [syncing, setSyncing] = useState<SyncKind | null>(null);

  async function syncNow(kind: SyncKind, label: string) {
    setSyncing(kind);
    const t0 = Date.now();
    try {
      const res = await fetch("/api/integrations/sync-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(`${label}: ${data.error ?? "sync failed"}`);
        return;
      }
      // Each lib returns slightly different shapes — render whatever's most useful.
      let summary = "";
      if (kind === "google_calendar") {
        summary = `${data.pulled ?? 0} pulled · ${data.deleted ?? 0} removed`;
      } else if (kind === "ghl") {
        summary = `${data.opportunities ?? 0} deals · ${data.pipelines ?? 0} pipelines`;
      } else if (kind === "plaid") {
        summary = `${data.accountsSeen ?? 0} accounts · +${data.transactionsAdded ?? 0} tx`;
      }
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      toast.success(`${label}: ${summary} (${elapsed}s)`);
      router.refresh();
    } catch {
      toast.error(`${label}: couldn't reach server`);
    } finally {
      setSyncing(null);
    }
  }

  // ---- Plaid -------------------------------------------------------------
  const [plaidLinkToken, setPlaidLinkToken] = useState<string | null>(null);
  const [plaidLoading, setPlaidLoading] = useState(false);
  const [disconnectingPlaid, setDisconnectingPlaid] = useState<string | null>(null);
  const [plaidReceivedRedirectUri, setPlaidReceivedRedirectUri] = useState<
    string | undefined
  >(undefined);

  // Detect OAuth resume on first render. When an OAuth bank (Chase, BofA, etc.)
  // redirects the user back to /integrations, the URL contains oauth_state_id.
  // The link_token we used before the redirect was stored in localStorage so
  // we can re-instantiate Plaid Link and resume.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("oauth_state_id")) {
      const saved = window.localStorage.getItem("plaid_link_token");
      if (saved) {
        setPlaidLinkToken(saved);
        setPlaidReceivedRedirectUri(window.location.href);
      }
    }
  }, []);

  const requestPlaidLinkToken = useCallback(async () => {
    setPlaidLoading(true);
    try {
      const res = await fetch("/api/plaid/create-link-token", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(`Plaid: ${data.error ?? "couldn't start link flow"}`);
        return;
      }
      // Persist for OAuth resume — banks may bounce the user away and back.
      if (typeof window !== "undefined") {
        window.localStorage.setItem("plaid_link_token", data.link_token);
      }
      setPlaidLinkToken(data.link_token);
      setPlaidReceivedRedirectUri(undefined);
    } catch {
      toast.error("Couldn't reach Plaid");
    } finally {
      setPlaidLoading(false);
    }
  }, []);

  const clearPlaidLinkState = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("plaid_link_token");
      // Strip the OAuth state from the URL so a hard refresh doesn't try to resume
      const url = new URL(window.location.href);
      if (url.searchParams.has("oauth_state_id")) {
        url.searchParams.delete("oauth_state_id");
        window.history.replaceState(null, "", url.pathname + url.search);
      }
    }
    setPlaidLinkToken(null);
    setPlaidReceivedRedirectUri(undefined);
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
      clearPlaidLinkState();
      router.refresh();
    },
    [router, clearPlaidLinkState]
  );

  const { open: openPlaid, ready: plaidReady } = usePlaidLink({
    token: plaidLinkToken,
    receivedRedirectUri: plaidReceivedRedirectUri,
    onSuccess: onPlaidSuccess,
    onExit: (err) => {
      if (err) toast.error(`Plaid: ${err.display_message ?? err.error_message ?? "cancelled"}`);
      clearPlaidLinkState();
    },
  });

  // Auto-open Plaid Link as soon as the token arrives — works for both the
  // initial open and the OAuth resume flow (since plaidLinkToken is set in
  // both paths).
  useEffect(() => {
    if (plaidLinkToken && plaidReady) openPlaid();
  }, [plaidLinkToken, plaidReady, openPlaid]);

  const [scopingItem, setScopingItem] = useState<string | null>(null);
  async function setPlaidItemScope(itemId: string, scope: "personal" | "business") {
    setScopingItem(itemId);
    const res = await fetch("/api/plaid/set-scope", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: itemId, scope }),
    });
    setScopingItem(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(`Couldn't tag: ${data.error ?? "update failed"}`);
      return;
    }
    toast.success(`Tagged as ${scope}`);
    router.refresh();
  }

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
            <div className="flex gap-2">
              <button
                onClick={() => syncNow("google_calendar", "Google Calendar")}
                disabled={syncing !== null}
                className="flex-1 py-2 rounded-lg text-sm font-semibold bg-white/5 hover:bg-white/10 text-zinc-200 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {syncing === "google_calendar" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Sync now
              </button>
              <button
                onClick={disconnectGoogle}
                disabled={disconnecting}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-500/20 hover:bg-red-500/30 text-red-300 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {disconnecting && <Loader2 className="size-3.5 animate-spin" />}
                Disconnect
              </button>
            </div>
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
                  className="bg-white/5 rounded-lg p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
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
                  {/* Scope toggle */}
                  <div className="flex items-center gap-1 text-[10px]">
                    <span className="text-zinc-500 mr-1">Tag:</span>
                    <button
                      onClick={() => setPlaidItemScope(it.id, "personal")}
                      disabled={scopingItem === it.id || it.scope === "personal"}
                      className={`px-2 py-0.5 rounded-full border ${
                        it.scope === "personal"
                          ? "bg-indigo-500/30 border-indigo-400 text-indigo-200"
                          : "bg-white/5 border-white/10 text-zinc-400 hover:bg-white/10"
                      } disabled:cursor-default flex items-center gap-1`}
                    >
                      {scopingItem === it.id && it.scope !== "personal" && (
                        <Loader2 className="size-2.5 animate-spin" />
                      )}
                      Personal
                    </button>
                    <button
                      onClick={() => setPlaidItemScope(it.id, "business")}
                      disabled={scopingItem === it.id || it.scope === "business"}
                      className={`px-2 py-0.5 rounded-full border ${
                        it.scope === "business"
                          ? "bg-amber-500/30 border-amber-400 text-amber-200"
                          : "bg-white/5 border-white/10 text-zinc-400 hover:bg-white/10"
                      } disabled:cursor-default flex items-center gap-1`}
                    >
                      {scopingItem === it.id && it.scope !== "business" && (
                        <Loader2 className="size-2.5 animate-spin" />
                      )}
                      Business
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            {plaidItems.length > 0 && (
              <button
                onClick={() => syncNow("plaid", "Plaid")}
                disabled={syncing !== null}
                className="flex-1 py-2 rounded-lg text-sm font-semibold bg-white/5 hover:bg-white/10 text-zinc-200 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {syncing === "plaid" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Sync now
              </button>
            )}
            <button
              onClick={requestPlaidLinkToken}
              disabled={plaidLoading || (plaidLinkToken !== null && !plaidReady)}
              className={`${
                plaidItems.length > 0 ? "flex-1" : "w-full"
              } py-2 rounded-lg text-sm font-semibold brand-gradient text-white flex items-center justify-center gap-2 disabled:opacity-50`}
            >
              {(plaidLoading || (plaidLinkToken !== null && !plaidReady)) && (
                <Loader2 className="size-3.5 animate-spin" />
              )}
              <Plug className="size-4" />{" "}
              {plaidItems.length > 0 ? "Connect another" : "Connect a bank"}
            </button>
          </div>
        </div>

        {/* GoHighLevel — env-configured, no UI flow but exposes Sync now */}
        <div className="glass-strong rounded-2xl p-5">
          <div className="flex items-start gap-3 mb-3">
            <div className="size-10 rounded-lg bg-amber-500/20 flex items-center justify-center text-amber-400">
              <Briefcase className="size-5" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold">GoHighLevel</h3>
              <p className="text-xs text-zinc-400">
                YLL pipeline + opportunities. Configured server-side via{" "}
                <code className="text-[10px]">GHL_API_KEY</code> +{" "}
                <code className="text-[10px]">GHL_LOCATION_ID</code>.
              </p>
            </div>
            {ghl.configured ? (
              <span className="badge text-xs px-2 py-1 rounded-full bg-amber-500/20 text-amber-300 flex items-center gap-1">
                <CheckCircle className="size-3" /> Configured
              </span>
            ) : (
              <span className="badge text-xs px-2 py-1 rounded-full bg-zinc-500/20 text-zinc-400 flex items-center gap-1">
                <XCircle className="size-3" /> Set env vars
              </span>
            )}
          </div>

          {ghl.configured && (
            <div className="bg-white/5 rounded-lg p-3 text-xs space-y-1 mb-3">
              <div>
                <span className="text-zinc-400">Opportunities mirrored:</span>{" "}
                <span className="font-semibold">{ghl.opportunityCount}</span>
              </div>
              <div>
                <span className="text-zinc-400">Last synced:</span>{" "}
                <span className="font-semibold">
                  {ghl.lastSyncedAt
                    ? new Date(ghl.lastSyncedAt).toLocaleString()
                    : "Never (waiting for next 30-min cron)"}
                </span>
              </div>
            </div>
          )}

          {ghl.configured ? (
            <button
              onClick={() => syncNow("ghl", "GoHighLevel")}
              disabled={syncing !== null}
              className="w-full py-2 rounded-lg text-sm font-semibold bg-white/5 hover:bg-white/10 text-zinc-200 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {syncing === "ghl" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Sync now
            </button>
          ) : (
            <p className="text-[11px] text-zinc-500 text-center py-1">
              Set <code>GHL_API_KEY</code>, <code>GHL_LOCATION_ID</code>, and{" "}
              <code>GHL_OWNER_USER_ID</code> on Render. See{" "}
              <code>PHASE3-PROGRESS.md</code> for full setup.
            </p>
          )}
        </div>

        {/* Apple Health — push-only via Health Auto Export, so no "sync now" */}
        <div
          id="apple-health"
          className="glass rounded-2xl p-5 flex flex-col gap-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <h3 className="font-bold flex items-center gap-2">
                <span aria-hidden>❤️</span> Apple Health
              </h3>
              <p className="text-[11px] text-zinc-500 mt-1">
                Pushed in via Health Auto Export ($6 iOS app) → our{" "}
                <code className="text-[10px]">/api/health/ingest-hae</code>{" "}
                endpoint.
              </p>
            </div>
            {health.configured ? (
              health.totalSamples > 0 ? (
                <span className="text-[10px] px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center gap-1 shrink-0">
                  <CheckCircle className="size-3" /> {health.totalSamples.toLocaleString()} samples
                </span>
              ) : (
                <span className="text-[10px] px-2 py-1 rounded-full bg-zinc-500/20 text-zinc-300 flex items-center gap-1 shrink-0">
                  Awaiting first push
                </span>
              )
            ) : (
              <span className="text-[10px] px-2 py-1 rounded-full bg-zinc-500/20 text-zinc-300 flex items-center gap-1 shrink-0">
                <XCircle className="size-3" /> Not configured
              </span>
            )}
          </div>

          {health.configured && health.lastReceivedAt && (
            <div className="text-[11px] space-y-1.5">
              <div className="flex justify-between text-zinc-400">
                <span>Last sample received</span>
                <span className="font-semibold text-zinc-200">
                  {new Date(health.lastReceivedAt).toLocaleString()}
                </span>
              </div>
              {health.byType.length > 0 && (
                <div className="mt-2 pt-2 border-t border-white/10">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
                    Last 7 days · {health.byType.length} metric{health.byType.length === 1 ? "" : "s"}
                  </div>
                  <div className="space-y-0.5 max-h-40 overflow-y-auto">
                    {health.byType.slice(0, 12).map((row) => (
                      <div
                        key={row.metric_type}
                        className="flex justify-between text-[10px]"
                      >
                        <span className="text-zinc-400 truncate">{row.metric_type}</span>
                        <span className="text-zinc-300 ml-2 shrink-0">
                          {row.count_7d.toLocaleString()} ·{" "}
                          {relativeMinutesAgo(row.latest)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {health.configured ? (
            <p className="text-[11px] text-zinc-500 text-center py-1">
              Health Auto Export pushes hourly — no manual sync needed.{" "}
              <a
                href="/health"
                className="text-indigo-400 hover:underline"
              >
                Open Health →
              </a>
            </p>
          ) : (
            <p className="text-[11px] text-zinc-500 text-center py-1">
              Set <code>HEALTH_INGEST_SECRET</code> + <code>HEALTH_INGEST_USER_ID</code> on Render, then configure HAE. See{" "}
              <code>PHASE5-PROGRESS.md</code> for full setup.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function relativeMinutesAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}
