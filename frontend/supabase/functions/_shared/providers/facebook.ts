// Facebook Pages via Meta Graph API.
// Requires a Facebook Page and permissions to read and publish posts.

import { env, HttpError } from "../http.ts";
import { type AccountIdentity, apiFetch, type Connection, type OAuthProvider, type TokenSet } from "./types.ts";

const graph = () => `https://graph.facebook.com/${env("META_GRAPH_VERSION") ?? "v23.0"}`;
const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_metadata",
  "business_management",
  "public_profile",
].join(",");

export const facebookOAuth: OAuthProvider = {
  platform: "facebook",
  usesPkce: false,
  configured: () => Boolean(env("META_APP_ID") && env("META_APP_SECRET")),
  authorizeUrl({ state, redirectUri }) {
    const q = new URLSearchParams({
      client_id: env("META_APP_ID")!,
      redirect_uri: redirectUri,
      state,
      scope: SCOPES,
      response_type: "code",
    });
    return `https://www.facebook.com/${env("META_GRAPH_VERSION") ?? "v23.0"}/dialog/oauth?${q}`;
  },
  async exchangeCode({ code, redirectUri }): Promise<TokenSet> {
    const short = await apiFetch(
      "facebook",
      `${graph()}/oauth/access_token?${new URLSearchParams({
        client_id: env("META_APP_ID")!,
        client_secret: env("META_APP_SECRET")!,
        redirect_uri: redirectUri,
        code,
      })}`,
    );
    // Exchange for long-lived access token
    const long = await apiFetch(
      "facebook",
      `${graph()}/oauth/access_token?${new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: env("META_APP_ID")!,
        client_secret: env("META_APP_SECRET")!,
        fb_exchange_token: short.data.access_token,
      })}`,
    );
    return {
      accessToken: long.data.access_token,
      expiresIn: long.data.expires_in ?? null,
      scopes: SCOPES.split(","),
    };
  },
  async identify(tokens, hint): Promise<AccountIdentity> {
    const { data } = await apiFetch(
      "facebook",
      `${graph()}/me/accounts?fields=id,name,access_token,link,username&limit=100&access_token=${encodeURIComponent(tokens.accessToken)}`,
    );
    const pages = data?.data ?? [];
    if (!pages.length) {
      throw new HttpError(
        400,
        "No Facebook Pages found for this account. Create or become an admin of a Facebook Page, then connect again.",
      );
    }
    const wanted = hint.orgName.toLowerCase();
    const page =
      pages.find((p: any) => String(p.name).toLowerCase().includes(wanted) || wanted.includes(String(p.name).toLowerCase())) ??
      pages[0];
    return {
      displayName: page.name,
      handle: page.username ? `@${page.username}` : page.name,
      externalId: page.id,
      profileUrl: page.link || `https://www.facebook.com/${page.id}`,
      pageToken: page.access_token,
    };
  },
};

function token(conn: Connection): string {
  return conn.pageToken ?? conn.accessToken;
}

export async function facebookCreatePost(
  conn: Connection,
  message: string,
  link?: string | null,
): Promise<{ postId: string; url: string }> {
  const body: Record<string, string> = {
    message,
    access_token: token(conn),
  };
  if (link) body.link = link;

  const { data } = await apiFetch("facebook", `${graph()}/${conn.externalId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });

  const postId = String(data.id);
  return {
    postId,
    url: `https://www.facebook.com/${postId.replace('_', '/posts/')}`,
  };
}

export async function facebookCreatePhotoPost(
  conn: Connection,
  photoUrl: string,
  caption?: string | null,
): Promise<{ postId: string; url: string }> {
  const body: Record<string, string> = {
    url: photoUrl,
    access_token: token(conn),
  };
  if (caption) body.caption = caption;

  const { data } = await apiFetch("facebook", `${graph()}/${conn.externalId}/photos`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });

  const postId = String(data.id || data.post_id);
  return {
    postId,
    url: `https://www.facebook.com/${postId}`,
  };
}

export async function facebookListPosts(
  conn: Connection,
  limit = 20,
): Promise<Array<{ id: string; message: string; createdTime: string; permalinkUrl: string }>> {
  const { data } = await apiFetch(
    "facebook",
    `${graph()}/${conn.externalId}/feed?fields=id,message,created_time,permalink_url&limit=${limit}&access_token=${encodeURIComponent(token(conn))}`,
  );
  return (data?.data ?? []).map((p: any) => ({
    id: p.id,
    message: p.message || "",
    createdTime: p.created_time,
    permalinkUrl: p.permalink_url || `https://www.facebook.com/${p.id}`,
  }));
}

export async function facebookReplyComment(
  conn: Connection,
  commentId: string,
  message: string,
): Promise<{ id: string }> {
  const { data } = await apiFetch("facebook", `${graph()}/${commentId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      message,
      access_token: token(conn),
    }).toString(),
  });
  return { id: String(data.id) };
}

