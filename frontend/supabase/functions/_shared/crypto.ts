// AES-256-GCM encryption for OAuth tokens at rest.
// TOKEN_ENCRYPTION_KEY: 32 random bytes, base64 (e.g. `openssl rand -base64 32`).

import { requireEnv } from "./http.ts";

let keyPromise: Promise<CryptoKey> | null = null;

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function key(): Promise<CryptoKey> {
  keyPromise ??= (async () => {
    const raw = b64decode(requireEnv("TOKEN_ENCRYPTION_KEY"));
    if (raw.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes");
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  })();
  return keyPromise;
}

/** Returns "v1.<iv>.<ciphertext>" so the format can be rotated later. */
export async function encryptSecret(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(plain)),
  );
  return `v1.${b64encode(iv)}.${b64encode(data)}`;
}

export async function decryptSecret(sealed: string): Promise<string> {
  const [version, iv, data] = sealed.split(".");
  if (version !== "v1" || !iv || !data) throw new Error("Unrecognized token format");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64decode(iv) }, await key(), b64decode(data));
  return new TextDecoder().decode(plain);
}

export function randomToken(bytes = 32): string {
  return b64encode(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return b64encode(digest).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

