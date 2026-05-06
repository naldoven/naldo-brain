/**
 * AES-256-GCM encryption for refresh tokens at rest.
 *
 * If naldo-brain's Supabase ever leaks, encrypted-at-rest tokens are useless
 * to the attacker without also stealing the TOKEN_ENCRYPTION_KEY env var.
 *
 * Format: <iv-hex>:<ciphertext-hex>:<auth-tag-hex>
 *
 * !!! NEVER change TOKEN_ENCRYPTION_KEY after authorizing accounts. !!!
 * Doing so makes all stored tokens un-decryptable and you'll have to re-
 * authorize every Gmail account.
 *
 * (Naldo-brain's calendar tokens in google_connections are NOT yet encrypted —
 * that's a known TODO. The inbox feature ships with encryption from day 1.)
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH_HEX = 64;

function getKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== KEY_LENGTH_HEX) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY env var must be a ${KEY_LENGTH_HEX}-character hex string (32 bytes). ` +
        `Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), encrypted.toString("hex"), authTag.toString("hex")].join(":");
}

export function decrypt(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid ciphertext format — expected iv:ciphertext:authTag");
  }
  const [ivHex, ciphertextHex, authTagHex] = parts;

  const key = getKey();
  const iv = Buffer.from(ivHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}
