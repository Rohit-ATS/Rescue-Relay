import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "drizzle/migrations/0017_close_workflow_write_boundaries.sql",
  "utf8",
);
const seed = readFileSync("supabase/seed-demo.sql", "utf8");
const creationHandler = readFileSync("src/lib/rescue.functions.ts", "utf8");
const onboarding = readFileSync("src/routes/_authenticated.onboarding.tsx", "utf8");

describe("security hardening boundaries", () => {
  it("removes the published fixture credential and does not reset existing passwords", () => {
    expect(seed).not.toContain("RescueRelay!2026");
    expect(seed).toContain("IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = demo.email)");
    expect(migration).toContain("UPDATE auth.users");
    expect(migration).toContain("banned_until = 'infinity'::timestamptz");
  });

  it("keeps coordinator provisioning out of self-service onboarding", () => {
    expect(onboarding).not.toContain('["coordinator"');
    expect(migration).toContain("Coordinator access requires administrator provisioning");
  });

  it("closes direct workflow writes while retaining server-only persistence", () => {
    expect(migration).toContain(
      "REVOKE INSERT ON TABLE public.donations, public.matches, public.rescue_events FROM authenticated",
    );
    expect(creationHandler).toContain('await import("@/integrations/supabase/client.server")');
    expect(creationHandler).toContain('supabaseAdmin.from("donations").insert');
    expect(creationHandler).toContain('supabaseAdmin.from("matches").insert');
    expect(creationHandler).toContain('supabaseAdmin.from("rescue_events").insert');
  });

  it("requires coordinator authority to disconnect a social account", () => {
    expect(migration).toContain('CREATE POLICY "Coordinators disconnect social accounts"');
    expect(migration).toContain(
      "public.is_org_member(org_id) AND public.has_role(auth.uid(), 'coordinator')",
    );
  });
});
