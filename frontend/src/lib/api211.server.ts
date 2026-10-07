// Server-only client for the 211 National Data Platform. Never import at the top
// level of a route or *.functions.ts module: load it inside a server handler with
// `const { request211 } = await import("@/lib/api211.server");`
//
// The subscription key is a secret. It is sent as the `Api-Key` header — the
// gateway also accepts an `api-key` query parameter, which this client does not
// use, because query strings end up in access logs.

/** The APIM gateway. Operation paths are hung off it as `{product}/{version}/{operation}`. */
const DEFAULT_BASE = "https://api.211.org";

/** 211 is a directory lookup, not a dispatch action; a slow answer is better dropped. */
const REQUEST_TIMEOUT_MS = 10000;

/** Thrown when no key is configured, so callers can degrade instead of erroring. */
export class Api211NotConfiguredError extends Error {}
/** The key was missing, wrong, or not subscribed to the product this operation belongs to. */
export class Api211AuthError extends Error {}
/** The gateway accepted the key but refused or failed the call. */
export class Api211RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}
/** The subscription's rate or quota limit was hit. `retryAfter` is seconds, when given. */
export class Api211RateLimitError extends Api211RequestError {
  constructor(
    message: string,
    status: number,
    body: string,
    readonly retryAfter?: number,
  ) {
    super(message, status, body);
  }
}

const base = () => (process.env["API211_BASE"] || DEFAULT_BASE).replace(/\/+$/, "");

/** False when no key is set, so a deployment without 211 access simply offers no 211 results. */
export const api211Configured = () => Boolean(process.env["API211_KEY"]);

export type Query = Record<string, string | number | boolean | undefined | null>;

/** Drops unset parameters rather than sending them empty, which the gateway treats as a value. */
function queryString(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/**
 * Calls one gateway operation and returns its parsed body.
 *
 * `path` is the operation path including the product and version segments, with
 * any template parameters already substituted — for example
 * `search/v1/api/Filters/DataOwners`.
 */
export async function request211<T>(path: string, query?: Query): Promise<T> {
  const key = process.env["API211_KEY"];
  if (!key) throw new Api211NotConfiguredError("API211_KEY is not set.");

  const url = `${base()}/${path.replace(/^\/+/, "")}${queryString(query)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "Api-Key": key, Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new Api211RequestError(
      aborted ? `211: timed out after ${REQUEST_TIMEOUT_MS}ms` : "211: request failed",
      0,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  if (!response.ok) {
    // The gateway answers 401 for a missing key and 403 for one that is not
    // subscribed to this product; both mean the same thing to a caller.
    if (response.status === 401 || response.status === 403)
      throw new Api211AuthError(`211: key rejected (HTTP ${response.status})`);
    if (response.status === 429) {
      const header = response.headers.get("retry-after");
      const retryAfter = header && Number.isFinite(Number(header)) ? Number(header) : undefined;
      throw new Api211RateLimitError("211: rate limit reached", 429, text, retryAfter);
    }
    throw new Api211RequestError(`211: HTTP ${response.status}`, response.status, text);
  }

  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Api211RequestError("211: response was not JSON", response.status, text);
  }
}
