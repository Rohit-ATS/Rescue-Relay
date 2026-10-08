// Authenticated completion for an OAuth callback. Requiring the initiating
// RescueRelay user here binds the provider response to the original browser session.

import { adminClient, resolveCaller } from "../_shared/auth.ts";
import { functionsBaseUrl, HttpError, json, serve } from "../_shared/http.ts";
import { getProvider, saveConnection } from "../_shared/providers/index.ts";
import { isSocialPlatform } from "../_shared/social/platforms.ts";

serve(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
  const body = await req.json().catch(() => ({}));
  const state = typeof body.state === "string" ? body.state : "";
  if (!state) throw new HttpError(400, "Missing OAuth callback state");

  const caller = await resolveCaller(req);
  if (caller.kind !== "user" || !caller.userId) throw new HttpError(401, "Sign in required");
  if (!caller.isCoordinator)
    throw new HttpError(403, "Coordinator access required to connect social accounts");

  const db = adminClient();
  const { data: stateRecord, error: stateErr } = await db
    .from("social_oauth_states")
    .delete()
    .eq("state", state)
    .eq("user_id", caller.userId)
    .gt("expires_at", new Date().toISOString())
    .select("org_id, user_id, platform, code_verifier, authorization_code")
    .maybeSingle();
  if (stateErr || !stateRecord)
    throw new HttpError(400, "Invalid, expired, or mismatched OAuth state");
  if (!stateRecord.authorization_code || !isSocialPlatform(stateRecord.platform)) {
    throw new HttpError(400, "Corrupted or incomplete OAuth state");
  }

  const provider = getProvider(stateRecord.platform);
  const redirectUri = `${functionsBaseUrl()}/oauth-callback`;
  const { data: org } = await db
    .from("organizations")
    .select("name")
    .eq("id", stateRecord.org_id)
    .maybeSingle();
  const tokens = await provider.exchangeCode({
    code: stateRecord.authorization_code,
    redirectUri,
    codeVerifier: stateRecord.code_verifier,
  });
  const identity = await provider.identify(tokens, { orgName: org?.name || "Community Partner" });
  await saveConnection(
    stateRecord.org_id,
    stateRecord.platform,
    identity,
    tokens,
    stateRecord.user_id,
  );
  return json({ platform: stateRecord.platform });
});
