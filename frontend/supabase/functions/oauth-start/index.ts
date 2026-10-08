// OAuth starting edge function: creates state, code_verifier (PKCE), and redirects to the provider authorization page.

import { adminClient, resolveCaller } from "../_shared/auth.ts";
import { pkceChallenge, randomToken } from "../_shared/crypto.ts";
import { appUrl, functionsBaseUrl, HttpError, json, serve } from "../_shared/http.ts";
import { getProvider } from "../_shared/providers/index.ts";
import { isSocialPlatform } from "../_shared/social/platforms.ts";

serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") {
    throw new HttpError(405, "Method not allowed");
  }

  const url = new URL(req.url);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const platform =
    typeof body.platform === "string" ? body.platform : url.searchParams.get("platform");
  const requestedReturn =
    typeof body.return_to === "string" ? body.return_to : url.searchParams.get("return_to");
  const app = new URL(appUrl());
  const defaultReturn = `${app.pathname.replace(/\/$/, "")}/dashboard?section=workflows`;
  let returnTo = defaultReturn;
  if (requestedReturn) {
    let candidate: URL;
    try {
      candidate = new URL(requestedReturn, appUrl());
    } catch {
      throw new HttpError(400, "Invalid return_to");
    }
    const basePath = app.pathname.replace(/\/$/, "");
    if (
      candidate.origin !== app.origin ||
      (basePath &&
        candidate.pathname !== basePath &&
        !candidate.pathname.startsWith(`${basePath}/`))
    ) {
      throw new HttpError(400, "return_to must stay within this application");
    }
    returnTo = `${candidate.pathname}${candidate.search}${candidate.hash}`;
  }

  if (!isSocialPlatform(platform)) {
    throw new HttpError(
      400,
      "Valid platform required: linkedin, instagram, x, google_business, facebook",
    );
  }

  const caller = await resolveCaller(req);
  if (!caller.isCoordinator)
    throw new HttpError(403, "Coordinator access required to connect social accounts");
  const provider = getProvider(platform);

  if (!provider.configured()) {
    throw new HttpError(
      501,
      `${provider.platform} developer keys are not configured yet on the server. Run in dry-run mode or configure credentials in Supabase secrets.`,
    );
  }

  const state = randomToken(32);
  let codeVerifier: string | null = null;
  let codeChallenge: string | undefined;

  if (provider.usesPkce) {
    codeVerifier = randomToken(48);
    codeChallenge = await pkceChallenge(codeVerifier);
  }

  const db = adminClient();
  await db.from("social_oauth_states").insert({
    state,
    org_id: caller.orgId,
    user_id: caller.userId ?? caller.orgId,
    platform,
    code_verifier: codeVerifier,
    return_to: returnTo,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });

  const redirectUri = `${functionsBaseUrl()}/oauth-callback`;
  const authUrl = provider.authorizeUrl({ state, redirectUri, codeChallenge });

  if (req.method === "POST" || req.headers.get("accept")?.includes("application/json")) {
    return json({ url: authUrl });
  }

  return Response.redirect(authUrl, 302);
});
