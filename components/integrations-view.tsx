"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Calendar, CheckCircle, XCircle, Loader2, Plug } from "lucide-react";
import { toast } from "sonner";

type GoogleConnection = {
  integration: string;
  account_email: string | null;
  last_synced_at: string | null;
  scope: string | null;
  created_at: string;
};

type Props = {
  googleCalendar: GoogleConnection | null;
};

export function IntegrationsView({ googleCalendar }: Props) {
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

        {/* Future integrations placeholder */}
        <div className="glass rounded-2xl p-5 border-2 border-dashed border-white/10">
          <div className="flex items-start gap-3 mb-3">
            <div className="size-10 rounded-lg bg-zinc-500/20 flex items-center justify-center text-zinc-500">
              <Plug className="size-5" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-zinc-400">More integrations coming</h3>
              <p className="text-xs text-zinc-500">
                Webhooks · Jobber ICS · GoHighLevel · Plaid (with Phases 3-5)
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
