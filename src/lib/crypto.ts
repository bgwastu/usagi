import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENC_PREFIX = "usagi1:";
const runtime = globalThis as typeof globalThis & { __usagiEncryptionKey?: string };

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function encryptPayload(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ENC_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function decryptPayload(payload: string, secret: string): string {
  if (!payload.startsWith(ENC_PREFIX)) throw new Error("Encrypted data expected.");
  const raw = Buffer.from(payload.slice(ENC_PREFIX.length), "base64url");
  if (raw.length < 28) throw new Error("Encrypted data is truncated or corrupt.");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  try {
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Unable to decrypt stored credentials. Check ENCRYPTION_KEY.");
  }
}

export function encryptionKey(): string | undefined {
  const key = runtime.__usagiEncryptionKey ?? process.env.ENCRYPTION_KEY?.trim();
  return key || undefined;
}

export function configureEncryptionKey(key?: string) {
  runtime.__usagiEncryptionKey = key?.trim() || "";
}
