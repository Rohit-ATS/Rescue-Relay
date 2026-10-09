// Instagram via Facebook Login for Business + Instagram Graph API.
// Requires an Instagram Business/Creator account linked to a Facebook Page.

import { env } from "../http.ts";
import { HttpError } from "../http.ts";
import {
  type AccountIdentity,
  apiFetch,
  type Connection,
  type OAuthProvider,
  type TokenSet,
} from "./types.ts";

const graph = () => `https://graph.facebook.com/${env("META_GRAPH_VERSION") ?? "v23.0"}`;
const SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "instagram_manage_insights",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
].join(",");

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export const instagramOAuth: OAuthProvider = {
  platform: "instagram",
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
    const short = await apiFetch("instagram", `${graph()}/oauth/access_token`, {
      method: "POST",
      form: {
        client_id: env("META_APP_ID")!,
        client_secret: env("META_APP_SECRET")!,
        redirect_uri: redirectUri,
        code,
      },
    });
    // Exchange for a ~60-day token; Page tokens derived from it do not expire.
    const long = await apiFetch("instagram", `${graph()}/oauth/access_token`, {
      method: "POST",
      form: {
        grant_type: "fb_exchange_token",
        client_id: env("META_APP_ID")!,
        client_secret: env("META_APP_SECRET")!,
        fb_exchange_token: short.data.access_token,
      },
    });
    return {
      accessToken: long.data.access_token,
      expiresIn: long.data.expires_in ?? null,
      scopes: SCOPES.split(","),
    };
  },
  async identify(tokens, hint): Promise<AccountIdentity> {
    const { data } = await apiFetch(
      "instagram",
      `${graph()}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100`,
      { headers: bearer(tokens.accessToken) },
    );
    const pages = (data?.data ?? []).filter((p: any) => p.instagram_business_account?.id);
    if (!pages.length) {
      throw new HttpError(
        400,
        "No Instagram Business account found. Link your Instagram professional account to a Facebook Page, then connect again.",
      );
    }
    const wanted = hint.orgName.toLowerCase();
    const page =
      pages.find(
        (p: any) =>
          String(p.name).toLowerCase().includes(wanted) ||
          wanted.includes(String(p.name).toLowerCase()),
      ) ?? pages[0];
    const ig = page.instagram_business_account;
    return {
      displayName: page.name,
      handle: `@${ig.username}`,
      externalId: ig.id,
      profileUrl: `https://www.instagram.com/${ig.username}/`,
      pageToken: page.access_token,
    };
  },
};

function token(conn: Connection): string {
  return conn.pageToken ?? conn.accessToken;
}

async function waitUntilReady(conn: Connection, containerId: string): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const { data } = await apiFetch("instagram", `${graph()}/${containerId}?fields=status_code`, {
      headers: bearer(token(conn)),
    });
    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR" || data.status_code === "EXPIRED") {
      throw new HttpError(
        422,
        `Instagram could not process the image (${data.status_code}). Use a public JPEG URL.`,
      );
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new HttpError(
    504,
    "Instagram is still processing the image; try publishing again in a minute.",
  );
}

export async function instagramPublish(
  conn: Connection,
  imageUrl: string,
  caption: string,
  asStory = false,
) {
  const container = await apiFetch("instagram", `${graph()}/${conn.externalId}/media`, {
    method: "POST",
    form: {
      image_url: imageUrl,
      ...(asStory ? { media_type: "STORIES" } : { caption }),
      access_token: token(conn),
    },
  });
  await waitUntilReady(conn, container.data.id);
  const published = await apiFetch("instagram", `${graph()}/${conn.externalId}/media_publish`, {
    method: "POST",
    form: { creation_id: container.data.id, access_token: token(conn) },
  });
  const mediaId = published.data.id as string;
  let url = "";
  try {
    const { data } = await apiFetch("instagram", `${graph()}/${mediaId}?fields=permalink`, {
      headers: bearer(token(conn)),
    });
    url = data.permalink ?? "";
  } catch {
    // Permalink is cosmetic; the post is already live.
  }
  return { id: mediaId, url };
}

export async function instagramListComments(conn: Connection, limit = 10) {
  const { data } = await apiFetch(
    "instagram",
    `${graph()}/${conn.externalId}/media?fields=id,permalink,comments.limit(25){id,text,username,timestamp}&limit=${limit}`,
    { headers: bearer(token(conn)) },
  );
  const handle = conn.handle.replace(/^@/, "");
  const out: Array<{
    id: string;
    postId: string;
    author: string;
    text: string;
    createdAt: string;
  }> = [];
  for (const media of data?.data ?? []) {
    for (const c of media.comments?.data ?? []) {
      if (c.username === handle) continue;
      out.push({
        id: c.id,
        postId: media.id,
        author: `@${c.username}`,
        text: c.text ?? "",
        createdAt: c.timestamp,
      });
    }
  }
  return out;
}

export async function instagramReply(conn: Connection, commentId: string, text: string) {
  const { data } = await apiFetch("instagram", `${graph()}/${commentId}/replies`, {
    method: "POST",
    form: { message: text, access_token: token(conn) },
  });
  return { id: data.id as string };
}

export async function instagramInsights(conn: Connection, mediaId: string) {
  const { data } = await apiFetch(
    "instagram",
    `${graph()}/${mediaId}/insights?metric=reach,likes,comments,shares,saved`,
    { headers: bearer(token(conn)) },
  );
  const out: Record<string, number> = {};
  for (const m of data?.data ?? [])
    out[m.name] = Number(m.values?.[0]?.value ?? m.total_value?.value ?? 0);
  return out;
}
