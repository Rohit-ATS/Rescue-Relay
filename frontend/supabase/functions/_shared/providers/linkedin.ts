// LinkedIn: OAuth 2.0 (3-legged) + Posts API / Social Actions API.
// Company-page posting needs the Community Management API product on the app.

import { env } from "../http.ts";
import { type AccountIdentity, apiFetch, type Connection, type OAuthProvider, type TokenSet } from "./types.ts";

const API = "https://api.linkedin.com";
const version = () => env("LINKEDIN_API_VERSION") ?? "202509";
const scopes = () =>
  env("LINKEDIN_SCOPES") ?? "openid profile w_member_social w_organization_social r_organization_social rw_organization_admin";

function restHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": version(),
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

function toTokenSet(data: any): TokenSet {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresIn: data.expires_in ?? null,
    scopes: typeof data.scope === "string" ? data.scope.split(/[ ,]+/).filter(Boolean) : [],
  };
}

export const linkedinOAuth: OAuthProvider = {
  platform: "linkedin",
  usesPkce: false,
  configured: () => Boolean(env("LINKEDIN_CLIENT_ID") && env("LINKEDIN_CLIENT_SECRET")),
  authorizeUrl({ state, redirectUri }) {
    const q = new URLSearchParams({
      response_type: "code",
      client_id: env("LINKEDIN_CLIENT_ID")!,
      redirect_uri: redirectUri,
      state,
      scope: scopes(),
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
  },
  async exchangeCode({ code, redirectUri }) {
    const { data } = await apiFetch("linkedin", "https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      form: {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: env("LINKEDIN_CLIENT_ID")!,
        client_secret: env("LINKEDIN_CLIENT_SECRET")!,
      },
    });
    return toTokenSet(data);
  },
  async refresh(refreshToken) {
    const { data } = await apiFetch("linkedin", "https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      form: {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: env("LINKEDIN_CLIENT_ID")!,
        client_secret: env("LINKEDIN_CLIENT_SECRET")!,
      },
    });
    return toTokenSet(data);
  },
  async identify(tokens): Promise<AccountIdentity> {
    // Prefer an organization page the member administers; fall back to the member.
    try {
      const { data: acls } = await apiFetch(
        "linkedin",
        `${API}/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`,
        { headers: restHeaders(tokens.accessToken) },
      );
      const orgUrn: string | undefined = acls?.elements?.[0]?.organization;
      if (orgUrn) {
        const orgId = orgUrn.split(":").pop()!;
        const { data: org } = await apiFetch("linkedin", `${API}/rest/organizations/${orgId}`, {
          headers: restHeaders(tokens.accessToken),
        });
        return {
          displayName: org.localizedName ?? "LinkedIn page",
          handle: org.vanityName ? `/company/${org.vanityName}` : orgUrn,
          externalId: orgUrn,
          profileUrl: org.vanityName ? `https://www.linkedin.com/company/${org.vanityName}` : "",
        };
      }
    } catch {
      // App lacks organization scopes — continue with the member identity.
    }
    const { data: me } = await apiFetch("linkedin", `${API}/v2/userinfo`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    return {
      displayName: me.name ?? "LinkedIn member",
      handle: me.email ?? me.name ?? "",
      externalId: `urn:li:person:${me.sub}`,
      profileUrl: "",
    };
  },
};

export async function linkedinCreatePost(conn: Connection, text: string) {
  const { headers } = await apiFetch("linkedin", `${API}/rest/posts`, {
    method: "POST",
    headers: restHeaders(conn.accessToken),
    body: JSON.stringify({
      author: conn.externalId,
      commentary: text,
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });
  const id = headers.get("x-restli-id") ?? headers.get("x-linkedin-id") ?? "";
  return { id, url: id ? `https://www.linkedin.com/feed/update/${id}` : "" };
}

export async function linkedinRecentPosts(conn: Connection, count = 10): Promise<string[]> {
  const { data } = await apiFetch(
    "linkedin",
    `${API}/rest/posts?q=author&author=${encodeURIComponent(conn.externalId)}&count=${count}`,
    { headers: { ...restHeaders(conn.accessToken), "X-RestLi-Method": "FINDER" } },
  );
  return (data?.elements ?? []).map((p: any) => p.id).filter(Boolean);
}

export async function linkedinListComments(conn: Connection, postUrn?: string) {
  const posts = postUrn ? [postUrn] : await linkedinRecentPosts(conn, 5);
  const out: Array<{ id: string; postId: string; author: string; text: string; createdAt: string }> = [];
  for (const urn of posts) {
    const { data } = await apiFetch("linkedin", `${API}/rest/socialActions/${encodeURIComponent(urn)}/comments`, {
      headers: restHeaders(conn.accessToken),
    });
    for (const c of data?.elements ?? []) {
      if (c.actor === conn.externalId) continue; // our own replies
      out.push({
        id: c.commentUrn ?? c.$URN ?? c.id,
        postId: urn,
        author: c.actor ?? "",
        text: c.message?.text ?? "",
        createdAt: c.created?.time ? new Date(c.created.time).toISOString() : new Date().toISOString(),
      });
    }
  }
  return out;
}

export async function linkedinReply(conn: Connection, postUrn: string, commentUrn: string | null, text: string) {
  const { headers, data } = await apiFetch(
    "linkedin",
    `${API}/rest/socialActions/${encodeURIComponent(commentUrn ?? postUrn)}/comments`,
    {
      method: "POST",
      headers: restHeaders(conn.accessToken),
      body: JSON.stringify({
        actor: conn.externalId,
        object: postUrn,
        message: { text },
        ...(commentUrn ? { parentComment: commentUrn } : {}),
      }),
    },
  );
  return { id: headers.get("x-restli-id") ?? data?.commentUrn ?? "" };
}

export async function linkedinPostStats(conn: Connection, postUrn: string) {
  const { data } = await apiFetch("linkedin", `${API}/rest/socialMetadata/${encodeURIComponent(postUrn)}`, {
    headers: restHeaders(conn.accessToken),
  });
  const reactions = Object.values(data?.reactionSummaries ?? {}).reduce(
    (sum: number, r: any) => sum + (Number(r?.count) || 0),
    0,
  );
  return { reactions, comments: Number(data?.commentSummary?.count ?? 0) };
}

