// OAuth callback edge function: handles code exchange, encryption, and redirect back to the frontend.

import { adminClient } from "../_shared/auth.ts";
import { appUrl, functionsBaseUrl, HttpError, serve } from "../_shared/http.ts";
import { getProvider, saveConnection } from "../_shared/providers/index.ts";
import { isSocialPlatform } from "../_shared/social/platforms.ts";

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  const defaultReturn = `${appUrl()}/dashboard?section=workflows`;

  if (error) {
    const dest = new URL(defaultReturn);
    dest.searchParams.set("social_error", `${error}: ${errorDescription || ""}`);
    return Response.redirect(dest.toString(), 302);
  }

  if (!code || !state) {
    throw new HttpError(400, "Missing code or state parameter");
  }

  const db = adminClient();
  const { data: stateRecord, error: stateErr } = await db
    .from("social_oauth_states")
    .select("org_id, user_id, platform, code_verifier, return_to")
    .eq("state", state)
    .maybeSingle();

  if (stateErr || !stateRecord) {
    throw new HttpError(400, "Invalid or expired OAuth state parameter");
  }

  // Delete consumed state
  await db.from("social_oauth_states").delete().eq("state", state);

  const platform = stateRecord.platform;
  if (!isSocialPlatform(platform)) {
    throw new HttpError(400, "Corrupted state record platform");
  }

  const provider = getProvider(platform);
  const redirectUri = `${functionsBaseUrl()}/oauth-callback`;

  // Fetch org name for hint
  const { data: org } = await db.from("organizations").select("name").eq("id", stateRecord.org_id).maybeSingle();
  const orgName = org?.name || "Community Partner";

  try {
    const tokens = await provider.exchangeCode({
      code,
      redirectUri,
      codeVerifier: stateRecord.code_verifier,
    });

    const identity = await provider.identify(tokens, { orgName });

    await saveConnection(stateRecord.org_id, platform, identity, tokens, stateRecord.user_id);

    const dest = new URL(stateRecord.return_to || defaultReturn);
    dest.searchParams.set("social_connected", platform);
    return Response.redirect(dest.toString(), 302);
  } catch (err: any) {
    const dest = new URL(stateRecord.return_to || defaultReturn);
    dest.searchParams.set("social_error", err.message || "Failed to link social account");
    return Response.redirect(dest.toString(), 302);
  }
});

