/** Portable WebCrypto only: used by the Worker and the offline operator tool. */
export const BACKUP_CHUNK_BYTES = 1_800_000;
export const BACKUP_MAX_CHUNKS = 20_000;
export const BACKUP_MAX_BYTES = 4_000_000_000;
export interface BackupKey { keyId: string; material: string }
export interface SealedBackup { version: 1; algorithm: "AES-256-GCM"; keyId: string; purpose: "chunk" | "manifest" | "cutover"; nonce: string; ciphertext: string }
function base64(bytes: Uint8Array) { let value = ""; for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(value); }
function bytes(value: string) { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
async function key(config: BackupKey) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(config.keyId) || !/^[A-Za-z0-9+/]{43}=$/.test(config.material)) throw new Error("BACKUP_KEY_REQUIRED");
  const raw = bytes(config.material);
  if (raw.length !== 32) throw new Error("BACKUP_KEY_REQUIRED");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function backupDigest(value: unknown) { return base64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))))); }
export async function sealBackup(value: unknown, purpose: SealedBackup["purpose"], config: BackupKey): Promise<SealedBackup> {
  const plain = new TextEncoder().encode(JSON.stringify(value));
  if (plain.length > BACKUP_CHUNK_BYTES) throw new Error("BACKUP_CHUNK_LIMIT");
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const header = { version: 1 as const, algorithm: "AES-256-GCM" as const, keyId: config.keyId, purpose };
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(JSON.stringify(header)), tagLength: 128 }, await key(config), plain);
  return { ...header, nonce: base64(nonce), ciphertext: base64(new Uint8Array(encrypted)) };
}
export async function openBackup(value: unknown, purpose: SealedBackup["purpose"], config: BackupKey): Promise<unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("BACKUP_INVALID");
  const sealed = value as SealedBackup;
  if (Object.keys(sealed).sort().join() !== "algorithm,ciphertext,keyId,nonce,purpose,version" || sealed.version !== 1 || sealed.algorithm !== "AES-256-GCM" || sealed.keyId !== config.keyId || sealed.purpose !== purpose || typeof sealed.nonce !== "string" || !/^[A-Za-z0-9+/]{16}$/.test(sealed.nonce) || typeof sealed.ciphertext !== "string" || sealed.ciphertext.length > Math.ceil((BACKUP_CHUNK_BYTES + 16) / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(sealed.ciphertext)) throw new Error("BACKUP_INVALID");
  const header = { version: sealed.version, algorithm: sealed.algorithm, keyId: sealed.keyId, purpose: sealed.purpose };
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(sealed.nonce), additionalData: new TextEncoder().encode(JSON.stringify(header)), tagLength: 128 }, await key(config), bytes(sealed.ciphertext));
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decrypted)) as unknown;
}
