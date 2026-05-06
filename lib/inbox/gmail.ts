/**
 * Gmail API wrapper for the Inbox module.
 *
 * Reuses naldo-brain's existing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET
 * env vars (same OAuth client used by Calendar). Gmail uses its own redirect
 * path (`/api/auth/google/gmail/callback`) and its own scope set, so authorizing
 * Calendar doesn't grant Gmail access and vice versa.
 *
 * Multi-account: unlike Calendar (one connection per user), users can have
 * multiple Gmail accounts (e.g. sales@, info@, personal). Tokens are stored
 * per email_accounts row, encrypted with TOKEN_ENCRYPTION_KEY.
 *
 * OAuth scope: gmail.modify covers read, archive, modify labels, create drafts,
 * send. Plus openid+email so we can identify the authorized account from the
 * id_token without an extra API call.
 */

import { gmail as gmailApi, gmail_v1 } from "@googleapis/gmail";
import { OAuth2Client } from "google-auth-library";
import { encrypt, decrypt } from "./encrypt";
import { getAppOrigin } from "@/lib/google-calendar";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailAccountRow } from "./types";

// Re-export the namespace so other modules can type their gmail client params.
export type { gmail_v1 };

const REDIRECT_PATH = "/api/auth/google/gmail/callback";
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "openid",
  "email",
];

function getRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}${REDIRECT_PATH}`;
}

export function getGmailOAuthClient(origin?: string): OAuth2Client {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth not configured — set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET",
    );
  }
  return new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri: getRedirectUri(origin ?? getAppOrigin()),
  });
}

export function buildGmailAuthorizeUrl(state: string, origin?: string): string {
  const oauth2 = getGmailOAuthClient(origin);
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "select_account consent",
    scope: GMAIL_SCOPES,
    state,
  });
}

/**
 * Get a Gmail API client authenticated as a specific email_account row.
 * Refreshes the access token when needed and persists rotation back to DB.
 */
export async function getGmailForAccount(
  supabase: SupabaseClient,
  account: EmailAccountRow,
): Promise<gmail_v1.Gmail> {
  const oauth2 = getGmailOAuthClient();
  const refreshToken = decrypt(account.refresh_token_encrypted);
  oauth2.setCredentials({
    refresh_token: refreshToken,
    access_token: account.access_token ?? undefined,
    expiry_date: account.access_token_expires_at
      ? new Date(account.access_token_expires_at).getTime()
      : undefined,
  });

  oauth2.on("tokens", async (tokens) => {
    if (!tokens.access_token) return;
    await supabase
      .from("email_accounts")
      .update({
        access_token: tokens.access_token,
        access_token_expires_at: tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : null,
        ...(tokens.refresh_token
          ? { refresh_token_encrypted: encrypt(tokens.refresh_token) }
          : {}),
      })
      .eq("id", account.id);
  });

  return gmailApi({ version: "v1", auth: oauth2 });
}

// ----------------------------------------------------------------------------
// List + fetch
// ----------------------------------------------------------------------------

export async function listNewInboxMessages(
  gmail: gmail_v1.Gmail,
  sinceISO: string,
): Promise<string[]> {
  // Gmail's `q` syntax expects unix epoch seconds for `after:`. Clamp to
  // 2010-01-01 minimum: passing epoch 0 caused Gmail to silently return zero
  // results (real-world bug from inbox-agent's first big cleanup).
  const MIN_AFTER_SEC = Math.floor(new Date("2010-01-01T00:00:00Z").getTime() / 1000);
  const rawSec = Math.floor(new Date(sinceISO).getTime() / 1000);
  const sinceSec = Math.max(rawSec, MIN_AFTER_SEC);
  const ids: string[] = [];
  let pageToken: string | undefined = undefined;

  while (true) {
    const params: gmail_v1.Params$Resource$Users$Messages$List = {
      userId: "me",
      q: `in:inbox after:${sinceSec}`,
      maxResults: 100,
      ...(pageToken ? { pageToken } : {}),
    };
    const res = await gmail.users.messages.list(params);
    for (const m of res.data.messages || []) {
      if (m.id) ids.push(m.id);
    }
    if (!res.data.nextPageToken) break;
    pageToken = res.data.nextPageToken;
  }

  return ids;
}

export interface FetchedEmailDetails {
  gmailMessageId: string;
  gmailThreadId: string;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  subject: string | null;
  snippet: string;
  bodyText: string;
  receivedAt: string;
  headers: Record<string, string>;
}

export async function getMessageDetails(
  gmail: gmail_v1.Gmail,
  messageId: string,
): Promise<FetchedEmailDetails> {
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });
  const msg = res.data;
  const headers: Record<string, string> = {};
  for (const h of msg.payload?.headers || []) {
    if (h.name && h.value) headers[h.name.toLowerCase()] = h.value;
  }

  const fromHeader = headers["from"] || "";
  const { name, email } = parseFromHeader(fromHeader);
  const toAddresses = (headers["to"] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => parseFromHeader(s).email);
  const subject = headers["subject"] ?? null;
  const dateHeader = headers["date"];
  const receivedAt = dateHeader
    ? new Date(dateHeader).toISOString()
    : new Date(Number(msg.internalDate || Date.now())).toISOString();

  return {
    gmailMessageId: messageId,
    gmailThreadId: msg.threadId || "",
    fromAddress: email,
    fromName: name,
    toAddresses,
    subject,
    snippet: msg.snippet || "",
    bodyText: extractPlainText(msg.payload),
    receivedAt,
    headers,
  };
}

// ----------------------------------------------------------------------------
// Mutations
// ----------------------------------------------------------------------------

export async function archiveMessage(
  gmail: gmail_v1.Gmail,
  messageId: string,
): Promise<void> {
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { removeLabelIds: ["INBOX"] },
  });
}

export async function unarchiveMessage(
  gmail: gmail_v1.Gmail,
  messageId: string,
): Promise<void> {
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { addLabelIds: ["INBOX"] },
  });
}

export async function trashMessage(
  gmail: gmail_v1.Gmail,
  messageId: string,
): Promise<void> {
  await gmail.users.messages.trash({
    userId: "me",
    id: messageId,
  });
}

export async function createOrFindGmailLabel(
  gmail: gmail_v1.Gmail,
  name: string,
): Promise<string> {
  const existing = await gmail.users.labels.list({ userId: "me" });
  const labels: gmail_v1.Schema$Label[] = existing.data.labels || [];
  const match = labels.find(
    (l) => l.name?.toLowerCase() === name.toLowerCase(),
  );
  if (match?.id) return match.id;

  const created = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });
  if (!created.data.id) throw new Error(`Gmail returned no label ID for '${name}'`);
  return created.data.id;
}

export async function applyGmailLabel(
  gmail: gmail_v1.Gmail,
  messageId: string,
  gmailLabelId: string,
  alsoArchive: boolean,
): Promise<void> {
  const removeLabelIds = alsoArchive ? ["INBOX"] : undefined;
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      addLabelIds: [gmailLabelId],
      ...(removeLabelIds ? { removeLabelIds } : {}),
    },
  });
}

export async function removeGmailLabel(
  gmail: gmail_v1.Gmail,
  messageId: string,
  gmailLabelId: string,
): Promise<void> {
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { removeLabelIds: [gmailLabelId] },
  });
}

export async function createDraftReply(args: {
  gmail: gmail_v1.Gmail;
  threadId: string;
  to: string;
  subject: string;
  bodyText: string;
  inReplyToMessageId?: string;
  references?: string;
}): Promise<string> {
  const subject = args.subject.toLowerCase().startsWith("re:")
    ? args.subject
    : `Re: ${args.subject}`;
  const headers = [
    `To: ${args.to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
  ];
  if (args.inReplyToMessageId) headers.push(`In-Reply-To: ${args.inReplyToMessageId}`);
  if (args.references) headers.push(`References: ${args.references}`);
  const raw = headers.join("\r\n") + "\r\n\r\n" + args.bodyText;
  const encoded = base64UrlEncode(raw);
  const res = await args.gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { threadId: args.threadId, raw: encoded } },
  });
  if (!res.data.id) throw new Error("Gmail returned no draft ID");
  return res.data.id;
}

export async function updateDraftBody(args: {
  gmail: gmail_v1.Gmail;
  draftId: string;
  threadId: string;
  to: string;
  subject: string;
  bodyText: string;
}): Promise<void> {
  const headers = [
    `To: ${args.to}`,
    `Subject: ${args.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
  ];
  const raw = headers.join("\r\n") + "\r\n\r\n" + args.bodyText;
  const encoded = base64UrlEncode(raw);
  await args.gmail.users.drafts.update({
    userId: "me",
    id: args.draftId,
    requestBody: { message: { threadId: args.threadId, raw: encoded } },
  });
}

export async function deleteDraft(
  gmail: gmail_v1.Gmail,
  draftId: string,
): Promise<void> {
  await gmail.users.drafts.delete({ userId: "me", id: draftId });
}

export async function listSentEmails(
  gmail: gmail_v1.Gmail,
  limit: number,
): Promise<{ subject: string; body: string; to: string }[]> {
  const list = await gmail.users.messages.list({
    userId: "me",
    q: "in:sent",
    maxResults: limit,
  });
  const out: { subject: string; body: string; to: string }[] = [];
  for (const m of list.data.messages || []) {
    if (!m.id) continue;
    const detail = await getMessageDetails(gmail, m.id);
    out.push({
      subject: detail.subject || "",
      body: detail.bodyText,
      to: detail.toAddresses[0] || "",
    });
  }
  return out;
}

export async function sendEmail(args: {
  gmail: gmail_v1.Gmail;
  to: string;
  subject: string;
  bodyHtml: string;
}): Promise<void> {
  const headers = [
    `To: ${args.to}`,
    `Subject: ${args.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
  ];
  const raw = headers.join("\r\n") + "\r\n\r\n" + args.bodyHtml;
  const encoded = base64UrlEncode(raw);
  await args.gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded },
  });
}

// ----------------------------------------------------------------------------
// Unsubscribe (RFC 8058 List-Unsubscribe header support)
// ----------------------------------------------------------------------------

export async function unsubscribeFromMessage(
  gmail: gmail_v1.Gmail,
  headers: Record<string, string>,
): Promise<{
  method: "one_click" | "mailto" | "manual_url" | "none";
  ok: boolean;
  fallbackUrl?: string;
  error?: string;
}> {
  const listUnsubscribe = headers["list-unsubscribe"];
  const listUnsubscribePost = headers["list-unsubscribe-post"] || "";
  if (!listUnsubscribe) return { method: "none", ok: false };

  const uris = Array.from(listUnsubscribe.matchAll(/<([^>]+)>/g)).map((m) => m[1]);
  const httpsUri = uris.find((u) => u.startsWith("https://") || u.startsWith("http://"));
  const mailtoUri = uris.find((u) => u.startsWith("mailto:"));
  const oneClickAvailable =
    /List-Unsubscribe\s*=\s*One-Click/i.test(listUnsubscribePost) && !!httpsUri;

  if (oneClickAvailable && httpsUri) {
    try {
      const res = await fetch(httpsUri, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
        redirect: "follow",
      });
      return { method: "one_click", ok: res.ok };
    } catch (err) {
      return { method: "one_click", ok: false, error: (err as Error).message };
    }
  }

  if (mailtoUri) {
    try {
      const target = mailtoUri.replace(/^mailto:/, "").split("?")[0];
      const raw = [
        `To: ${target}`,
        `Subject: unsubscribe`,
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="UTF-8"',
        "",
        "unsubscribe",
      ].join("\r\n");
      const encoded = base64UrlEncode(raw);
      await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw: encoded },
      });
      return { method: "mailto", ok: true };
    } catch (err) {
      return { method: "mailto", ok: false, error: (err as Error).message };
    }
  }

  if (httpsUri) {
    return { method: "manual_url", ok: false, fallbackUrl: httpsUri };
  }

  return { method: "none", ok: false };
}

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

function base64UrlEncode(s: string): string {
  return Buffer.from(s, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function parseFromHeader(value: string): { name: string | null; email: string } {
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) {
    const name = match[1].trim();
    return { name: name.length ? name : null, email: match[2].trim() };
  }
  return { name: null, email: value.trim() };
}

function extractPlainText(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  const plain = findPart(payload, "text/plain");
  if (plain && plain.body?.data) return decodeBase64Url(plain.body.data);
  const html = findPart(payload, "text/html");
  if (html && html.body?.data) return stripHtml(decodeBase64Url(html.body.data));
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  return "";
}

function findPart(
  part: gmail_v1.Schema$MessagePart,
  mimeType: string,
): gmail_v1.Schema$MessagePart | null {
  if (part.mimeType === mimeType) return part;
  for (const child of part.parts || []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf-8",
  );
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
