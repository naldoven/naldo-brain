/**
 * Google Calendar integration — OAuth helpers + sync logic.
 *
 * Tokens stored in google_connections table. RLS protects them; service-role
 * bypasses for the cron sync. (Encryption-at-rest is the next iteration.)
 */
import { OAuth2Client } from "google-auth-library";
import { calendar as calendarApi, calendar_v3 } from "@googleapis/calendar";
import type { SupabaseClient } from "@supabase/supabase-js";

const REDIRECT_PATH = "/api/auth/google/calendar/callback";
const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",      // read/write events on calendars I'm shown
  "https://www.googleapis.com/auth/calendar.readonly",    // list all my calendars (work, shared, family)
  "openid",
  "email",
  "profile",                                              // populates account_email on Integrations card
];

function getRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}${REDIRECT_PATH}`;
}

export function getAppOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit;
  return "https://naldo-brain.onrender.com";
}

export function getOAuthClient(origin?: string): OAuth2Client {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth not configured — set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET"
    );
  }
  return new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri: getRedirectUri(origin ?? getAppOrigin()),
  });
}

export function buildAuthorizeUrl(state: string, origin?: string): string {
  const oauth2 = getOAuthClient(origin);
  return oauth2.generateAuthUrl({
    access_type: "offline",
    // "select_account" forces the account picker every time — fixes auto-login to wrong account
    // "consent" guarantees a refresh_token is issued
    prompt: "select_account consent",
    scope: CALENDAR_SCOPES,
    state,
  });
}

/**
 * Persist tokens after OAuth callback. Updates if a connection already exists.
 */
export async function persistTokens(
  supabase: SupabaseClient,
  userId: string,
  tokens: {
    access_token?: string | null;
    refresh_token?: string | null;
    expiry_date?: number | null;
    scope?: string | null;
  }
): Promise<void> {
  // Capture the user's primary email (looks better in UI than just "Connected")
  let accountEmail: string | null = null;
  try {
    const oauth2 = getOAuthClient();
    oauth2.setCredentials({
      access_token: tokens.access_token ?? undefined,
      refresh_token: tokens.refresh_token ?? undefined,
      expiry_date: tokens.expiry_date ?? undefined,
      scope: tokens.scope ?? undefined,
    });
    const tokenInfo = await oauth2.getTokenInfo(tokens.access_token ?? "");
    accountEmail = tokenInfo.email ?? null;
  } catch {
    // Best effort — not fatal
  }

  const expiry = tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null;

  const { data: existing } = await supabase
    .from("google_connections")
    .select("id")
    .eq("user_id", userId)
    .eq("integration", "calendar")
    .maybeSingle();

  if (existing) {
    await supabase
      .from("google_connections")
      .update({
        access_token: tokens.access_token ?? null,
        refresh_token: tokens.refresh_token ?? null,
        scope: tokens.scope ?? null,
        expiry_date: expiry,
        account_email: accountEmail,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    await supabase.from("google_connections").insert({
      user_id: userId,
      integration: "calendar",
      access_token: tokens.access_token ?? null,
      refresh_token: tokens.refresh_token ?? null,
      scope: tokens.scope ?? null,
      expiry_date: expiry,
      account_email: accountEmail,
    });
  }
}

/**
 * Load tokens for a user. Auto-refreshes if expired.
 * Returns null if user is not connected.
 */
export async function getAuthorizedClient(
  supabase: SupabaseClient,
  userId: string
): Promise<OAuth2Client | null> {
  const { data } = await supabase
    .from("google_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("integration", "calendar")
    .maybeSingle();

  if (!data || !data.refresh_token) return null;

  const oauth2 = getOAuthClient();
  oauth2.setCredentials({
    access_token: data.access_token ?? undefined,
    refresh_token: data.refresh_token,
    expiry_date: data.expiry_date ? new Date(data.expiry_date).getTime() : undefined,
    scope: data.scope ?? undefined,
  });

  // Persist refreshed tokens whenever the library auto-refreshes
  oauth2.on("tokens", async (newTokens) => {
    if (!newTokens.access_token && !newTokens.expiry_date) return;
    await supabase
      .from("google_connections")
      .update({
        access_token: newTokens.access_token ?? data.access_token,
        expiry_date: newTokens.expiry_date
          ? new Date(newTokens.expiry_date).toISOString()
          : data.expiry_date,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("integration", "calendar");
  });

  return oauth2;
}

/**
 * Disconnect: revoke at Google + delete the row.
 */
export async function disconnect(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const auth = await getAuthorizedClient(supabase, userId);
  if (auth) {
    try {
      await auth.revokeCredentials();
    } catch {
      // Ignore — even if revoke fails, delete row so user is not stuck
    }
  }
  await supabase
    .from("google_connections")
    .delete()
    .eq("user_id", userId)
    .eq("integration", "calendar");
}

// ============================================================================
// Sync — pull events from Google → local; push local mutations → Google.
// ============================================================================

type LocalEvent = {
  id: string;
  user_id: string;
  external_id: string | null;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  color: string | null;
  source: string;
};

const SYNC_WINDOW_DAYS_BACK = 30;
const SYNC_WINDOW_DAYS_FWD = 365;

/**
 * Pull events from EVERY calendar the user has selected (primary + work +
 * shared + family + holidays etc.) into the local table.
 *
 * Falls back to "primary"-only if calendarList.list fails (e.g., the user
 * granted only the legacy `calendar.events` scope). Re-syncs are idempotent
 * via the (connection_id, external_id) lookup.
 */
export async function pullEvents(
  supabase: SupabaseClient,
  userId: string
): Promise<{ pulled: number; deleted: number }> {
  const auth = await getAuthorizedClient(supabase, userId);
  if (!auth) return { pulled: 0, deleted: 0 };

  // Find connection row to attach connection_id to events
  const { data: conn } = await supabase
    .from("google_connections")
    .select("id")
    .eq("user_id", userId)
    .eq("integration", "calendar")
    .maybeSingle();
  if (!conn) return { pulled: 0, deleted: 0 };

  const cal = calendarApi({ version: "v3", auth });

  // Discover all visible calendars. Falls back to ["primary"] if the user
  // didn't grant calendar.readonly.
  type CalMeta = { id: string; color: string };
  let calendarsToSync: CalMeta[] = [{ id: "primary", color: "#10B981" }];
  try {
    const { data: calList } = await cal.calendarList.list();
    const items = (calList.items ?? []).filter(
      (c) => !c.deleted && c.selected !== false && c.id
    );
    if (items.length > 0) {
      calendarsToSync = items.map((c) => ({
        id: c.id!,
        color: c.backgroundColor || "#10B981",
      }));
    }
  } catch (err) {
    console.warn(
      "[google-calendar] calendarList.list failed; falling back to primary",
      err instanceof Error ? err.message : err
    );
  }

  const now = new Date();
  const timeMin = new Date(
    now.getTime() - SYNC_WINDOW_DAYS_BACK * 24 * 60 * 60 * 1000
  ).toISOString();
  const timeMax = new Date(
    now.getTime() + SYNC_WINDOW_DAYS_FWD * 24 * 60 * 60 * 1000
  ).toISOString();

  let pulled = 0;
  let deleted = 0;

  for (const calMeta of calendarsToSync) {
    let pageToken: string | undefined = undefined;
    do {
      let res: { data: calendar_v3.Schema$Events };
      try {
        res = await cal.events.list({
          calendarId: calMeta.id,
          timeMin,
          timeMax,
          singleEvents: true, // expand recurring instances
          maxResults: 250,
          orderBy: "startTime",
          pageToken,
        });
      } catch (err) {
        // One bad calendar (e.g., a sub-calendar we lost access to) shouldn't
        // sink the whole sync. Log and skip it.
        console.warn(
          "[google-calendar] events.list failed",
          calMeta.id,
          err instanceof Error ? err.message : err
        );
        break;
      }

      const items = res.data.items ?? [];
      for (const e of items) {
        if (!e.id) continue;

        // Cancelled events: delete locally
        if (e.status === "cancelled") {
          const { error } = await supabase
            .from("calendar_events")
            .delete()
            .eq("user_id", userId)
            .eq("connection_id", conn.id)
            .eq("external_id", e.id);
          if (!error) deleted++;
          continue;
        }

        const allDay = Boolean(e.start?.date);
        const startsAt = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00Z` : null);
        const endsAt = e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T23:59:59Z` : null);
        if (!startsAt) continue;

        // Look up existing by (connection_id, external_id)
        const { data: existing } = await supabase
          .from("calendar_events")
          .select("id")
          .eq("user_id", userId)
          .eq("connection_id", conn.id)
          .eq("external_id", e.id)
          .maybeSingle();

        const payload = {
          user_id: userId,
          connection_id: conn.id,
          external_id: e.id,
          title: e.summary ?? "(no title)",
          description: e.description ?? null,
          starts_at: startsAt,
          ends_at: endsAt,
          all_day: allDay,
          color: calMeta.color, // each calendar's own Google color
          source: "google",
          updated_at: new Date().toISOString(),
        };

        const { error: writeErr } = existing
          ? await supabase
              .from("calendar_events")
              .update(payload)
              .eq("id", existing.id)
          : await supabase.from("calendar_events").insert(payload);
        if (writeErr) {
          // Don't count as pulled — surfaces failures instead of silently
          // claiming success.
          console.error("[google-calendar] write failed", {
            calendar: calMeta.id,
            external_id: e.id,
            error: writeErr.message,
          });
          continue;
        }
        pulled++;
      }

      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  // Update last_synced_at
  await supabase
    .from("google_connections")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", conn.id);

  return { pulled, deleted };
}

/**
 * Push a local event to Google. Sets external_id so we don't create a duplicate next sync.
 */
export async function pushCreate(
  supabase: SupabaseClient,
  userId: string,
  event: LocalEvent
): Promise<void> {
  const auth = await getAuthorizedClient(supabase, userId);
  if (!auth) return;

  const cal = calendarApi({ version: "v3", auth });

  const body: calendar_v3.Schema$Event = {
    summary: event.title,
    description: event.description ?? undefined,
  };

  if (event.all_day) {
    body.start = { date: event.starts_at.slice(0, 10) };
    body.end = { date: (event.ends_at ?? event.starts_at).slice(0, 10) };
  } else {
    body.start = { dateTime: event.starts_at };
    body.end = { dateTime: event.ends_at ?? event.starts_at };
  }

  const { data: created } = await cal.events.insert({
    calendarId: "primary",
    requestBody: body,
  });

  if (created?.id) {
    const { data: conn } = await supabase
      .from("google_connections")
      .select("id")
      .eq("user_id", userId)
      .eq("integration", "calendar")
      .maybeSingle();
    await supabase
      .from("calendar_events")
      .update({
        external_id: created.id,
        connection_id: conn?.id ?? null,
        source: "google",
        color: event.color ?? "#10B981",
      })
      .eq("id", event.id);
  }
}

export async function pushUpdate(
  supabase: SupabaseClient,
  userId: string,
  event: LocalEvent
): Promise<void> {
  if (!event.external_id) return; // Locally-only event — was never pushed
  const auth = await getAuthorizedClient(supabase, userId);
  if (!auth) return;

  const cal = calendarApi({ version: "v3", auth });

  const body: calendar_v3.Schema$Event = {
    summary: event.title,
    description: event.description ?? undefined,
  };
  if (event.all_day) {
    body.start = { date: event.starts_at.slice(0, 10) };
    body.end = { date: (event.ends_at ?? event.starts_at).slice(0, 10) };
  } else {
    body.start = { dateTime: event.starts_at };
    body.end = { dateTime: event.ends_at ?? event.starts_at };
  }

  await cal.events.update({
    calendarId: "primary",
    eventId: event.external_id,
    requestBody: body,
  });
}

export async function pushDelete(
  supabase: SupabaseClient,
  userId: string,
  externalId: string
): Promise<void> {
  const auth = await getAuthorizedClient(supabase, userId);
  if (!auth) return;
  const cal = calendarApi({ version: "v3", auth });
  try {
    await cal.events.delete({
      calendarId: "primary",
      eventId: externalId,
    });
  } catch {
    // 404 etc. — not fatal
  }
}
