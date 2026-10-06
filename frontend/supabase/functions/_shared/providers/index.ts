// Central registry connecting platforms, oauth clients, and encrypted token loading.

import { adminClient } from "../auth.ts";
import { decryptSecret, encryptSecret } from "../crypto.ts";
import { HttpError } from "../http.ts";
import { type SocialPlatform } from "../social/platforms.ts";
import { googleBusinessOAuth } from "./google-business.ts";
import { instagramOAuth } from "./instagram.ts";
import { linkedinOAuth } from "./linkedin.ts";
import { type Connection, type OAuthProvider } from "./types.ts";
import { xOAuth } from "./x.ts";

export const PROVIDERS: Record<SocialPlatform, OAuthProvider> = {
  linkedin: linkedinOAuth,
  instagram: instagramOAuth,
  x: xOAuth,
  google_business: googleBusinessOAuth,
};

export function getProvider(platform: SocialPlatform): OAuthProvider {
  const p = PROVIDERS[platform];
  if (!p) throw new HttpError(400, `Unsupported platform: ${platform}`);
  return p;
}

/** Loads and decrypts tokens for an organization's connected social account. */
export async function loadConnection(orgId: string, platform: SocialPlatform): Promise<Connection | null> {
  const db = adminClient();
  const { data: account, error: accErr } = await db
    .from("social_accounts")
    .select("id, status, handle, external_id")
    .eq("org_id", orgId)
    .eq("platform", platform)
    .maybeSingle();

  if (accErr || !account) return null;

  const { data: tokens, error: tokErr } = await db
    .from("social_account_tokens")
    .select("access_token_enc, refresh_token_enc, page_token_enc, expires_at")
    .eq("account_id", account.id)
    .maybeSingle();

  if (tokErr || !tokens) return null;

  const accessToken = await decryptSecret(tokens.access_token_enc);
  const pageToken = tokens.page_token_enc ? await decryptSecret(tokens.page_token_enc) : null;

  return {
    accountId: account.id,
    orgId,
    platform,
    externalId: account.external_id,
    handle: account.handle,
    accessToken,
    pageToken,
  };
}

/** Stores/updates a connection and encrypts tokens into social_account_tokens. */
export async function saveConnection(
  orgId: string,
  platform: SocialPlatform,
  identity: { displayName: string; handle: string; externalId: string; profileUrl: string; pageToken?: string | null },
  tokens: { accessToken: string; refreshToken?: string | null; expiresIn?: number | null; scopes?: string[] },
  connectedBy?: string | null,
): Promise<string> {
  const db = adminClient();

  const { data: account, error: accErr } = await db
    .from("social_accounts")
    .upsert(
      {
        org_id: orgId,
        platform,
        status: "connected",
        display_name: identity.displayName,
        handle: identity.handle,
        external_id: identity.externalId,
        profile_url: identity.profileUrl,
        scopes: tokens.scopes ?? [],
        last_error: "",
        connected_by: connectedBy ?? null,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id,platform" },
    )
    .select("id")
    .single();

  if (accErr || !account) {
    throw new HttpError(500, `Failed to save account record: ${accErr?.message}`);
  }

  const accessEnc = await encryptSecret(tokens.accessToken);
  const refreshEnc = tokens.refreshToken ? await encryptSecret(tokens.refreshToken) : null;
  const pageEnc = identity.pageToken ? await encryptSecret(identity.pageToken) : null;
  const expiresAt = tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString() : null;

  const { error: tokErr } = await db.from("social_account_tokens").upsert({
    account_id: account.id,
    access_token_enc: accessEnc,
    refresh_token_enc: refreshEnc,
    page_token_enc: pageEnc,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });

  if (tokErr) {
    throw new HttpError(500, `Failed to store encrypted tokens: ${tokErr.message}`);
  }

  return account.id;
}
