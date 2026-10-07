-- Hackathon demo access.
--
-- The app has no sign-in screen: every visitor is given a real anonymous Supabase
-- session instead. That session is what the whole security model rests on, because
-- auth.uid() is what every RLS policy tests. The previous build handed the router a
-- placeholder user object with no session at all, so auth.uid() was NULL, every
-- policy refused, and the client silently fell back to a per-browser localStorage
-- store — which is why nothing a visitor posted ever reached anyone else.
--
-- claim_initial_role() cannot serve this: it grants exactly one role, refuses
-- 'coordinator' outright, and raises once a role already exists. A judge needs to
-- post surplus, accept it, drive it and verify partners in one sitting.
--
-- This widens who may act, NOT what is visible or writable: every policy, grant and
-- locked transition function still applies. Rescue state still moves only through
-- respond_to_match, claim_delivery and advance_delivery.

CREATE OR REPLACE FUNCTION public.claim_demo_access(_full_name text DEFAULT 'Hackathon Guest')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE demo_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  -- Everyone lands in the same verified donor organization, so posted surplus is
  -- attributed to a real partner and every visitor is looking at one workspace.
  SELECT id INTO demo_org
  FROM public.organizations
  WHERE type = 'donor' AND verification_status = 'verified'
  ORDER BY created_at
  LIMIT 1;

  INSERT INTO public.profiles (id, full_name, organization_id, onboarding_complete, vehicle_capacity_lbs, food_safety_training)
  VALUES (auth.uid(), trim(_full_name), demo_org, true, 250, true)
  ON CONFLICT (id) DO UPDATE
    SET organization_id = COALESCE(public.profiles.organization_id, excluded.organization_id),
        onboarding_complete = true,
        updated_at = now();

  -- Idempotent: a returning visitor re-runs this on every load.
  INSERT INTO public.user_roles (user_id, role)
  SELECT auth.uid(), r
  FROM unnest(ARRAY['donor','recipient','driver','coordinator']::public.app_role[]) AS r
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_demo_access(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_demo_access(text) TO authenticated;

COMMENT ON FUNCTION public.claim_demo_access(text) IS 'Hackathon only: grants the calling anonymous session every operating role. Drop this function to restore approval-gated roles.';
