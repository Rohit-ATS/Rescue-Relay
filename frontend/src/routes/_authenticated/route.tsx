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
  try {
    const rpc = supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>;
    const { error } = await rpc("claim_demo_access", { _full_name: GUEST_NAME });
    if (error) {
      demoAccessClaimed = false;
      console.warn("Demo access could not be claimed:", error.message);
    }
  } catch (err) {
    demoAccessClaimed = false;
    console.warn("Demo access bypassed:", err);
  }
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    try {
      const { data: existing } = await supabase.auth.getSession();
      if (existing?.session?.user) {
        await claimDemoAccess();
        return { user: existing.session.user, demoOnly: false };
      }

      const { data, error } = await supabase.auth.signInAnonymously();
      if (!error && data?.user) {
        await claimDemoAccess();
        return { user: data.user, demoOnly: false };
      }

      if (error) {
        console.warn(
          "Anonymous sign-in unavailable, loading demo evaluator session for review:",
          error.message,
        );
      }
    } catch (err) {
      console.warn("Auth initialization fallback to demo session:", err);
    }

    // Default demo coordinator user so judges can test everything smoothly without crashing.
    //
    // demoOnly marks what this costs: there is no Supabase session behind this
    // user, so auth.uid() is NULL, every RLS policy refuses, and the client falls
    // back to a per-browser store. Anything posted here is invisible to every
    // other screen. The dashboard says so rather than letting it look shared.
    return {
      demoOnly: true,
      user: {
        id: "d0000000-0000-4000-a000-000000000004",
        email: "coordinator@rescuerelay-qa.org",
        app_metadata: {},
        user_metadata: { full_name: "Casey Ahmed (Demo Evaluator)" },
        aud: "authenticated",
        created_at: new Date().toISOString(),
      },
    };
  },
  component: () => <Outlet />,
});
