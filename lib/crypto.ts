/**
 * Symmetric token encryption for at-rest storage of secrets that the
 * application later needs in plaintext (Plaid access tokens, GHL PIT,
 * future OAuth refresh tokens that aren't already a server-only env var).
 *
 * Algorithm: AES-256-GCM. The 12-byte IV is randomly generated per encrypt
 * call and stored alongside the ciphertext + auth tag. GCM gives both
 * confidentiality and integrity — a tampered ciphertext fails decryption.
 *
 * Key source: PLAID_TOKEN_ENCRYPTION_KEY env var. Accepts:
 * - 64 hex chars (output of `openssl rand -hex 32`) — recommended
 * - 44 base64 chars (32 bytes encoded)
 *
 * Storage format: `enc:v1:<iv>:<tag>:<ciphertext>` where each part is
 * base64. The `enc:v1:` prefix lets us detect already-encrypted vs
 * legacy plaintext rows for lazy migration.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const PREFIX = "enc:v1:";
const KEY_BYTES = 32;
const IV_BYTES = 12;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.PLAID_TOKEN_ENCRYPTION_KEY;
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      "PLAID_TOKEN_ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` and add it to Render env."
    );
  }
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw.trim())) {
    key = Buffer.from(raw.trim(), "hex");
  } else {
    try {
      key = Buffer.from(raw.trim(), "base64");
    } catch {
      throw new Error("PLAID_TOKEN_ENCRYPTION_KEY must be 64 hex chars or base64-encoded 32 bytes");
    }
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `PLAID_TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length})`
    );
  }
  cachedKey = key;
  return key;
}

/** True when the value already has our `enc:v1:` prefix. */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/**
 * Encrypt a plaintext token. Idempotent: if already encrypted, returns
 * the input unchanged (so callers don't double-encrypt by accident).
 */
export function encryptToken(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptToken: empty plaintext");
  }
  if (isEncrypted(plaintext)) return plaintext;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, getKey(), iv) as CipherGCM;
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/**
 * Decrypt a stored value. Backward-compatible: if the input is *not*
 * prefixed (legacy plaintext), returns the input unchanged. This means
 * callers never need to branch on whether a row has been migrated yet.
 */
export function decryptToken(stored: string | null | undefined): string {
  if (!stored || stored.length === 0) {
    throw new Error("decryptToken: empty input");
  }
  if (!isEncrypted(stored)) return stored;
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("decryptToken: malformed ciphertext (expected 3 colon-separated parts)");
  }
  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  if (iv.length !== IV_BYTES) {
    throw new Error(`decryptToken: bad iv length (${iv.length} bytes)`);
  }
  const decipher = createDecipheriv(ALGO, getKey(), iv) as DecipherGCM;
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plaintext.toString("utf8");
}
