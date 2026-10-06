// X (Twitter) API v2 with OAuth 2.0 Authorization Code + PKCE (confidential client).

import { env } from "../http.ts";
import { type AccountIdentity, apiFetch, type Connection, type OAuthProvider, type TokenSet } from "./types.ts";

const API = "https://api.x.com/2";
const SCOPES = "tweet.read tweet.write users.read offline.access";

function basicAuth(): string {
  return `Basic ${btoa(`${env("X_CLIENT_ID")}:${env("X_CLIENT_SECRET")}`)}`;
}

function toTokenSet(data: any): TokenSet {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresIn: data.expires_in ?? null,
    scopes: typeof data.scope === "string" ? data.scope.split(" ") : [],
  };
}

export const xOAuth: OAuthProvider = {
  platform: "x",
  usesPkce: true,
  configured: () => Boolean(env("X_CLIENT_ID") && env("X_CLIENT_SECRET")),
  authorizeUrl({ state, redirectUri, codeChallenge }) {
    const q = new URLSearchParams({
      response_type: "code",
      client_id: env("X_CLIENT_ID")!,
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
      code_challenge: codeChallenge!,
      code_challenge_method: "S256",
    });
    return `https://x.com/i/oauth2/authorize?${q}`;
  },
  async exchangeCode({ code, redirectUri, codeVerifier }) {
    const { data } = await apiFetch("x", `${API}/oauth2/token`, {
      method: "POST",
      headers: { Authorization: basicAuth() },
      form: {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier ?? "",
        client_id: env("X_CLIENT_ID")!,
      },
    });
    return toTokenSet(data);
  },
  async refresh(refreshToken) {
    const { data } = await apiFetch("x", `${API}/oauth2/token`, {
      method: "POST",
      headers: { Authorization: basicAuth() },
      form: { grant_type: "refresh_token", refresh_token: refreshToken, client_id: env("X_CLIENT_ID")! },
    });
    return toTokenSet(data);
  },
  async identify(tokens): Promise<AccountIdentity> {
    const { data } = await apiFetch("x", `${API}/users/me`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const user = data.data;
    return {
      displayName: user.name,
      handle: `@${user.username}`,
      externalId: user.id,
      profileUrl: `https://x.com/${user.username}`,
    };
  },
};

function postUrl(conn: Connection, id: string): string {
  return `https://x.com/${conn.handle.replace(/^@/, "")}/status/${id}`;
}

export async function xCreatePost(conn: Connection, text: string, replyToId?: string | null) {
  const { data } = await apiFetch("x", `${API}/tweets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${conn.accessToken}` },
    body: JSON.stringify({ text, ...(replyToId ? { reply: { in_reply_to_tweet_id: replyToId } } : {}) }),
  });
  const id = data.data.id as string;
  return { id, url: postUrl(conn, id) };
}

export async function xCreateThread(conn: Connection, parts: string[]) {
  const posted: Array<{ id: string; url: string }> = [];
  let previous: string | null = null;
  for (const part of parts) {
    const result = await xCreatePost(conn, part, previous);
    posted.push(result);
    previous = result.id;
  }
  return posted;
}

export async function xListMentions(conn: Connection, max = 20) {
  const q = new URLSearchParams({
    max_results: String(Math.min(100, Math.max(5, max))),
    "tweet.fields": "created_at,author_id,conversation_id",
    expansions: "author_id",
    "user.fields": "username",
  });
  const { data } = await apiFetch("x", `${API}/users/${conn.externalId}/mentions?${q}`, {
    headers: { Authorization: `Bearer ${conn.accessToken}` },
  });
  const users = new Map<string, string>((data?.includes?.users ?? []).map((u: any) => [u.id, u.username]));
  return (data?.data ?? []).map((t: any) => ({
    id: t.id as string,
    postId: (t.conversation_id ?? t.id) as string,
    author: users.has(t.author_id) ? `@${users.get(t.author_id)}` : t.author_id,
    text: t.text as string,
    createdAt: t.created_at as string,
  }));
}

