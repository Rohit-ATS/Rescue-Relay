// Google Business Profile (the listing shown on Google Maps & Search).
// Local posts and reviews use the v4 My Business API; account/location
// discovery and hours use the v1 Account Management / Business Information APIs.

import { env, HttpError } from "../http.ts";
import { type AccountIdentity, apiFetch, type Connection, type OAuthProvider, type TokenSet } from "./types.ts";

const V4 = "https://mybusiness.googleapis.com/v4";
const ACCOUNTS = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO = "https://mybusinessbusinessinformation.googleapis.com/v1";
const SCOPES = "https://www.googleapis.com/auth/business.manage";

function toTokenSet(data: any): TokenSet {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresIn: data.expires_in ?? null,
    scopes: typeof data.scope === "string" ? data.scope.split(" ") : [],
  };
}

export const googleBusinessOAuth: OAuthProvider = {
  platform: "google_business",
  usesPkce: false,
  configured: () => Boolean(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET")),
  authorizeUrl({ state, redirectUri }) {
    const q = new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID")!,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  },
  async exchangeCode({ code, redirectUri }) {
    const { data } = await apiFetch("google_business", "https://oauth2.googleapis.com/token", {
      method: "POST",
      form: {
        code,
        client_id: env("GOOGLE_CLIENT_ID")!,
        client_secret: env("GOOGLE_CLIENT_SECRET")!,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      },
    });
    return toTokenSet(data);
  },
  async refresh(refreshToken) {
    const { data } = await apiFetch("google_business", "https://oauth2.googleapis.com/token", {
      method: "POST",
      form: {
        refresh_token: refreshToken,
        client_id: env("GOOGLE_CLIENT_ID")!,
        client_secret: env("GOOGLE_CLIENT_SECRET")!,
        grant_type: "refresh_token",
      },
    });
    return toTokenSet(data);
  },
  async identify(tokens, hint): Promise<AccountIdentity> {
    const auth = { Authorization: `Bearer ${tokens.accessToken}` };
    const { data: accounts } = await apiFetch("google_business", `${ACCOUNTS}/accounts`, { headers: auth });
    const wanted = hint.orgName.toLowerCase();
    let best: { account: string; location: any } | null = null;
    for (const account of accounts?.accounts ?? []) {
      const { data } = await apiFetch(
        "google_business",
        `${INFO}/${account.name}/locations?readMask=name,title,metadata&pageSize=100`,
        { headers: auth },
      );
      for (const location of data?.locations ?? []) {
        const title = String(location.title ?? "").toLowerCase();
        const matches = title.includes(wanted) || wanted.includes(title);
        if (!best || matches) best = { account: account.name, location };
        if (matches) break;
      }
    }
    if (!best) {
      throw new HttpError(400, "No Google Business Profile locations found for this Google account.");
    }
    const locationId = String(best.location.name).replace(/^locations\//, "");
    return {
      displayName: best.location.title ?? "Business location",
      handle: best.location.title ?? "",
      externalId: `${best.account}/locations/${locationId}`,
      profileUrl: best.location.metadata?.mapsUri ?? "",
    };
  },
};

export interface LocalPostInput {
  summary: string;
  topicType?: "STANDARD" | "EVENT" | "OFFER";
  eventTitle?: string;
  startIso?: string;
  endIso?: string;
  callToActionUrl?: string;
}

function dateParts(iso: string) {
  const d = new Date(iso);
  return {
    date: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() },
    time: { hours: d.getUTCHours(), minutes: d.getUTCMinutes() },
  };
}

export async function gbpCreateLocalPost(conn: Connection, input: LocalPostInput) {
  const topicType = input.topicType ?? "STANDARD";
  const body: Record<string, unknown> = { languageCode: "en-US", summary: input.summary, topicType };
  if (topicType === "EVENT" || topicType === "OFFER") {
    if (!input.startIso || !input.endIso) throw new HttpError(400, "EVENT and OFFER posts need startIso and endIso");
    const start = dateParts(input.startIso);
    const end = dateParts(input.endIso);
    body.event = {
      title: input.eventTitle ?? "Free food distribution",
      schedule: { startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time },
    };
  }
  if (input.callToActionUrl) body.callToAction = { actionType: "LEARN_MORE", url: input.callToActionUrl };
  const { data } = await apiFetch("google_business", `${V4}/${conn.externalId}/localPosts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${conn.accessToken}` },
    body: JSON.stringify(body),
  });
  return { id: data.name as string, url: (data.searchUrl as string) ?? "" };
}

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export async function gbpListReviews(conn: Connection, pageSize = 20) {
  const { data } = await apiFetch("google_business", `${V4}/${conn.externalId}/reviews?pageSize=${pageSize}`, {
    headers: { Authorization: `Bearer ${conn.accessToken}` },
  });
  return (data?.reviews ?? []).map((r: any) => ({
    id: r.reviewId as string,
    author: r.reviewer?.displayName ?? "Google user",
    text: r.comment ?? "",
    rating: STARS[r.starRating] ?? null,
    createdAt: r.createTime as string,
    alreadyReplied: Boolean(r.reviewReply?.comment),
  }));
}

export async function gbpReplyToReview(conn: Connection, reviewId: string, text: string) {
  await apiFetch("google_business", `${V4}/${conn.externalId}/reviews/${encodeURIComponent(reviewId)}/reply`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${conn.accessToken}` },
    body: JSON.stringify({ comment: text }),
  });
  return { id: reviewId };
}

export interface HoursPeriod {
  day: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
  open: string; // "09:00"
  close: string; // "17:00"
}

export async function gbpUpdateHours(conn: Connection, periods: HoursPeriod[]) {
  const location = conn.externalId.split("/").slice(-2).join("/"); // locations/{id}
  const time = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return { hours: h ?? 0, minutes: m ?? 0 };
  };
  await apiFetch("google_business", `${INFO}/${location}?updateMask=regularHours`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${conn.accessToken}` },
    body: JSON.stringify({
      regularHours: {
        periods: periods.map((p) => ({ openDay: p.day, openTime: time(p.open), closeDay: p.day, closeTime: time(p.close) })),
      },
    }),
  });
  return { updated: periods.length };
}

