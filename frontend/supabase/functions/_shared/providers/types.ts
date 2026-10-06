// Common provider contract and HTTP helper for the platform clients.

import type { SocialPlatform } from "../social/platforms.ts";

export interface TokenSet {
  accessToken: string;
  refreshToken?: string | null;
  /** Seconds until access token expiry, if the provider says. */
  expiresIn?: number | null;
  scopes?: string[];
}

export interface AccountIdentity {
  displayName: string;
  handle: string;
  externalId: string;
  profileUrl: string;
  /** Instagram: Facebook Page token used for publishing. */
  pageToken?: string | null;
}

export interface Connection {
  accountId: string;
  orgId: string;
  platform: SocialPlatform;
  externalId: string;
  handle: string;
  accessToken: string;
  pageToken: string | null;
}

export interface OAuthProvider {
  platform: SocialPlatform;
  /** True when client id/secret env vars are present. */
  configured(): boolean;
  usesPkce: boolean;
  authorizeUrl(args: { state: string; redirectUri: string; codeChallenge?: string }): string;
  exchangeCode(args: { code: string; redirectUri: string; codeVerifier?: string | null }): Promise<TokenSet>;
  refresh?(refreshToken: string): Promise<TokenSet>;
  identify(tokens: TokenSet, hint: { orgName: string }): Promise<AccountIdentity>;
}

export class ProviderError extends Error {
  constructor(
    public platform: SocialPlatform,
    public status: number,
    message: string,
    public body: unknown = null,
  ) {
    super(message);
  }
  /** 401/403 from the platform usually means the token was revoked or lacks scope. */
  get needsReauth(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

function describe(body: unknown): string {
  if (!body || typeof body !== "object") return typeof body === "string" ? body.slice(0, 300) : "";
  const b = body as Record<string, any>;
  return String(
    b.error?.message ?? b.error_description ?? b.detail ?? b.message ?? b.title ?? b.errors?.[0]?.message ?? JSON.stringify(b).slice(0, 300),
  );
}

export async function apiFetch<T = any>(
  platform: SocialPlatform,
  url: string,
  init: RequestInit & { form?: Record<string, string> } = {},
): Promise<{ data: T; headers: Headers }> {
  const { form, ...rest } = init;
  const headers = new Headers(rest.headers);
  let body = rest.body;
  if (form) {
    headers.set("Content-Type", "application/x-www-form-urlencoded");
    body = new URLSearchParams(form).toString();
  } else if (body && typeof body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...rest, headers, body });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new ProviderError(platform, res.status, `${platform} API ${res.status}: ${describe(data)}`, data);
  }
  return { data: data as T, headers: res.headers };
}

