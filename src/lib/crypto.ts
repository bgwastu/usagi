import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ENC_PREFIX = "usagi1:";

function dataDir() {
  return path.join(process.cwd(), "data");
}

export function dataFilePath() {
  return path.join(dataDir(), "data.json");
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function encryptPayload(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return (
    ENC_PREFIX +
    Buffer.concat([iv, tag, encrypted]).toString("base64url")
  );
}

export function decryptPayload(payload: string, secret: string): string {
  if (!payload.startsWith(ENC_PREFIX)) {
    throw new Error("Encrypted data expected but file is not in usagi1 envelope.");
  }
  const raw = Buffer.from(payload.slice(ENC_PREFIX.length), "base64url");
  if (raw.length < 28) {
    throw new Error("Encrypted data is truncated or corrupt.");
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const key = deriveKey(secret);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error(
      "Unable to decrypt data.json with ENCRYPTION_KEY. Check the key or restore a backup.",
    );
  }
}

export function ensureDataDir() {
  const dir = dataDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function readRawStore(): string | null {
  const file = dataFilePath();
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8");
}

export function writeRawStore(contents: string) {
  ensureDataDir();
  writeFileSync(dataFilePath(), contents, { mode: 0o600 });
}

export function isEncryptedBlob(contents: string): boolean {
  return contents.trimStart().startsWith(ENC_PREFIX);
}
