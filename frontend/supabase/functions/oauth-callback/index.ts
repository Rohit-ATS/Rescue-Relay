// OAuth callback edge function: handles code exchange, encryption, and redirect back to the frontend.

import { adminClient } from "../_shared/auth.ts";
import { appUrl, HttpError, serve } from "../_shared/http.ts";

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  const app = new URL(appUrl());
  const defaultReturn = `${app.pathname.replace(/\/$/, "")}/dashboard?section=workflows`;

  let returnTo = defaultReturn;
  const db = adminClient();
  if (state) {
    const { data: stateRecord } = await db
      .from("social_oauth_states")
      .select("return_to")
      .eq("state", state)
      .maybeSingle();
    if (stateRecord?.return_to) {
      try {
        const candidate = new URL(stateRecord.return_to, appUrl());
        const basePath = app.pathname.replace(/\/$/, "");
        if (
          candidate.origin === app.origin &&
          (!basePath ||
            candidate.pathname === basePath ||
            candidate.pathname.startsWith(`${basePath}/`))
        ) {
          returnTo = `${candidate.pathname}${candidate.search}${candidate.hash}`;
        }
      } catch {
        // Fall back to the configured application path for malformed legacy state.
      }
    }
  }

  const destination = new URL(returnTo, appUrl());

  if (error) {
    if (state) await db.from("social_oauth_states").delete().eq("state", state);
    destination.searchParams.set(
      "social_error",
      errorDescription ? `${error}: ${errorDescription}` : error,
    );
    return Response.redirect(destination.toString(), 302);
  }

  if (!code || !state) {
    throw new HttpError(400, "Missing code or state parameter");
  }

  const { data: stateRecord, error: stateErr } = await db
    .from("social_oauth_states")
    .select("expires_at")
    .eq("state", state)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (stateErr || !stateRecord) {
    throw new HttpError(400, "Invalid or expired OAuth state parameter");
  }
  const { data: claimedState, error: updateError } = await db
    .from("social_oauth_states")
    .update({ authorization_code: code })
    .eq("state", state)
    .gt("expires_at", new Date().toISOString())
    .is("authorization_code", null)
    .select("state")
    .maybeSingle();
  if (updateError || !claimedState) {
    throw new HttpError(400, "Invalid or expired OAuth state parameter");
  }

  destination.searchParams.set("oauth_state", state);
  return Response.redirect(destination.toString(), 302);
});
