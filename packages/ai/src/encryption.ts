/**
 * AES-256-GCM encryption for the AI Config api key.
 *
 * Why this exists:
 * - The LLM api key is sensitive user input (admin sets it via the UI).
 * - DB dumps, slow-query logs, and accidental SELECTs in a console
 *   should not leak it in plaintext.
 * - AES-256-GCM is the standard authenticated cipher for at-rest
 *   secrets in Node.js (no extra deps — uses the built-in `crypto`).
 *
 * Key management:
 * - The master key is sourced from `AI_CONFIG_ENCRYPTION_KEY` env var.
 * - It MUST be exactly 32 bytes (256 bits), hex-encoded (64 chars).
 * - Generate one with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
 * - Store it in `.env` (gitignored) on the server, never in code.
 *
 * Storage format (apiKeyCipher column):
 *   base64( iv (12 bytes) || ciphertext (variable) || authTag (16 bytes) )
 * - We pack the iv + ciphertext + tag into one base64 string so the
 *   column stays a single TEXT field and round-trips through Prisma
 *   without JSON wrapping.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // GCM standard
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;

function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const hex = process.env.AI_CONFIG_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      'AI_CONFIG_ENCRYPTION_KEY env var is not set. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(
      'AI_CONFIG_ENCRYPTION_KEY must be 64 hex chars (32 bytes). ' +
        'Got length ' + hex.length
    );
  }
  cachedKey = Buffer.from(hex, 'hex');
  return cachedKey;
}

/**
 * Encrypt a UTF-8 string with the master key.
 * Returns a single base64 string suitable for a TEXT column.
 */
export function encryptSecret(plaintext: string): string {
  const key = getMasterKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString('base64');
}

/**
 * Decrypt a base64 string produced by `encryptSecret`.
 * Throws on tampering (GCM auth tag mismatch) or wrong key.
 */
export function decryptSecret(packed: string): string {
  const key = getMasterKey();
  const buf = Buffer.from(packed, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error('Ciphertext too short — corrupted or wrong format');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Mask an api key for display: "sk-...1234" (first 4 + last 4). */
export function maskApiKey(plaintext: string): string {
  if (plaintext.length <= 8) return '****';
  return `${plaintext.slice(0, 4)}...${plaintext.slice(-4)}`;
}
