import twilio from "twilio";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER ?? "+16316346178";

let _client: ReturnType<typeof twilio> | null = null;

export function getTwilioClient() {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error(
      "Twilio not configured — set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN env vars"
    );
  }
  if (!_client) {
    _client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }
  return _client;
}

export function getFromNumber(): string {
  return `whatsapp:${TWILIO_WHATSAPP_NUMBER.replace(/\s+/g, "")}`;
}

export async function sendWhatsAppMessage({
  to,
  body,
}: {
  to: string;
  body: string;
}) {
  const client = getTwilioClient();
  const cleanedTo = to.replace(/\s+/g, "");
  const toFormatted = cleanedTo.startsWith("whatsapp:")
    ? cleanedTo
    : `whatsapp:${cleanedTo}`;

  return client.messages.create({
    from: getFromNumber(),
    to: toFormatted,
    body,
  });
}

export function isTwilioConfigured(): boolean {
  return Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN);
}
