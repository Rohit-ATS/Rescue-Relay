// Supabase admin client and caller authentication for edge functions.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { env, HttpError, requireEnv } from "./http.ts";

let admin: SupabaseClient | null = null;

/** Service-role client. Bypasses RLS — every query must scope by org_id itself. */
export function adminClient(): SupabaseClient {
  admin ??= createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

export interface Caller {
  kind: "user" | "internal";
  userId: string | null;
  /** Organization the request acts for. */
  orgId: string;
  isCoordinator: boolean;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isInternal(req: Request): boolean {
  const secret = env("INTERNAL_FUNCTION_SECRET");
  const given = req.headers.get("x-internal-secret");
  return Boolean(secret && given && timingSafeEqual(secret, given));
}

/**
 * Resolves who is calling and for which organization.
 *  - Internal calls (other edge functions, pg_cron) pass x-internal-secret + x-org-id.
 *  - Users pass their Supabase JWT; the org comes from their profile, or — for
 *    coordinators only — from an explicit x-org-id / body org_id.
 */
export async function resolveCaller(req: Request, requestedOrgId?: string | null): Promise<Caller> {
  const headerOrg = req.headers.get("x-org-id");
  if (isInternal(req)) {
    const orgId = requestedOrgId ?? headerOrg;
    if (!orgId) throw new HttpError(400, "x-org-id is required for internal calls");
    return { kind: "internal", userId: null, orgId, isCoordinator: true };
  }

  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in required");
  const db = adminClient();
  const { data: userData, error } = await db.auth.getUser(token);
  if (error || !userData.user) throw new HttpError(401, "Session expired — sign in again");
  const userId = userData.user.id;

  const [{ data: profile }, { data: roles }] = await Promise.all([
    db.from("profiles").select("organization_id").eq("id", userId).maybeSingle(),
    db.from("user_roles").select("role").eq("user_id", userId),
  ]);
  const isCoordinator = (roles ?? []).some((r: { role: string }) => r.role === "coordinator");
  const wanted = requestedOrgId ?? headerOrg ?? null;
  const ownOrg = (profile?.organization_id as string | null) ?? null;

  let orgId: string | null = ownOrg;
  if (wanted && wanted !== ownOrg) {
    if (!isCoordinator) throw new HttpError(403, "You can only manage your own organization");
    orgId = wanted;
  }
  if (!orgId) throw new HttpError(400, "Join or create an organization before connecting social accounts");
  return { kind: "user", userId, orgId, isCoordinator };
}

