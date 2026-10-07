import { createFileRoute, Outlet } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/** Shown on the demo profile so a judge can tell sessions apart. */
const GUEST_NAME = "Hackathon Guest";

/** Set once per tab, so a reload does not re-run the role grant needlessly. */
let demoAccessClaimed = false;

/**
 * Grants this session every operating role, so one visitor can post surplus,
 * accept it, drive it and verify partners without an approval step.
 *
 * Failure is deliberately not fatal: the workspace still loads, just with
 * whatever roles the session already had.
 */
async function claimDemoAccess() {
  if (demoAccessClaimed) return;
  demoAccessClaimed = true;
  // Cast because integrations/supabase/types.ts is generated from the live
  // database, which does not carry this function until migration 0015 is
  // applied. Regenerating the types afterwards makes the cast redundant.
  const rpc = supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ error: { message: string } | null }>;
  const { error } = await rpc("claim_demo_access", { _full_name: GUEST_NAME });
  if (error) {
    demoAccessClaimed = false;
    console.warn("Demo access could not be claimed:", error.message);
  }
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // There is no sign-in screen. Every visitor gets a REAL anonymous Supabase
    // session rather than a placeholder user object, because auth.uid() is what
    // every RLS policy tests: without a session the database refuses every read
    // and write, and the client falls back to a per-browser store that no one
    // else can see. A real session is what makes the workspace shared and live.
    const { data: existing } = await supabase.auth.getSession();
    if (existing.session?.user) {
      await claimDemoAccess();
      return { user: existing.session.user };
    }

    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.user) {
      // Anonymous sign-in is a project setting; if it is off, say so plainly
      // rather than letting every query fail with an opaque permission error.
      console.error(
        "Anonymous sign-in failed. Enable it in Supabase → Authentication → Providers → Anonymous.",
        error?.message,
      );
      throw new Error(
        "Could not start a demo session. Anonymous sign-in is disabled for this Supabase project.",
      );
    }

    await claimDemoAccess();
    return { user: data.user };
  },
  component: () => <Outlet />,
});
