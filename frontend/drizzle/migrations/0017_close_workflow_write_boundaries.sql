-- Close browser-write paths that could bypass the authenticated server workflow.
-- This migration is deliberately additive so it can be applied after any existing
-- deployment state without rewriting prior migration history.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- A temporary hackathon helper may exist in deployments where its removal migration
-- was not applied. Browser demo state is local-only and does not need this function.
DROP FUNCTION IF EXISTS public.claim_demo_access(text);

-- Coordinators are provisioned by a deployment administrator or an explicit seed,
-- never by self-service onboarding.
CREATE OR REPLACE FUNCTION public.claim_initial_role(_role public.app_role, _full_name text, _organization_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _role = 'coordinator' THEN RAISE EXCEPTION 'Coordinator access requires administrator provisioning'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()) THEN RAISE EXCEPTION 'Role already assigned'; END IF;
  IF char_length(trim(_full_name)) < 2 OR char_length(trim(_full_name)) > 100 THEN RAISE EXCEPTION 'Invalid name'; END IF;
  IF _role IN ('donor', 'recipient') THEN RAISE EXCEPTION 'Organization membership must be requested for this role'; END IF;
  IF _organization_id IS NOT NULL THEN RAISE EXCEPTION 'Organization assignment requires approval'; END IF;

  INSERT INTO public.profiles (id, full_name, organization_id, onboarding_complete, vehicle_capacity_lbs, food_safety_training)
  VALUES (auth.uid(), trim(_full_name), NULL, true, CASE WHEN _role = 'driver' THEN 250 ELSE 0 END, _role = 'driver')
  ON CONFLICT (id) DO UPDATE SET full_name = excluded.full_name, organization_id = excluded.organization_id, onboarding_complete = true, updated_at = now();
  INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(), _role);
END;
$$;

-- The public seed formerly disclosed a shared password. Invalidate it on existing
-- environments while retaining fixture identities and their historical records.
UPDATE auth.users
SET encrypted_password = crypt(encode(gen_random_bytes(32), 'hex'), gen_salt('bf')),
    banned_until = 'infinity'::timestamptz,
    updated_at = now()
WHERE email IN (
  'donor@rescuerelay-qa.org',
  'recipient@rescuerelay-qa.org',
  'driver@rescuerelay-qa.org',
  'coordinator@rescuerelay-qa.org'
);

-- Donation creation, scoring, and event writing run in the authenticated server
-- handler with service-role persistence. Direct browser DML must not bypass it.
REVOKE INSERT ON TABLE public.donations, public.matches, public.rescue_events FROM authenticated;
DROP POLICY IF EXISTS "Donors create donations" ON public.donations;
DROP POLICY IF EXISTS "Donors create candidate matches" ON public.matches;
DROP POLICY IF EXISTS "Coordinators create matches" ON public.matches;
DROP POLICY IF EXISTS "Authenticated users create rescue events" ON public.rescue_events;

-- A connection is coordinator-owned from OAuth start through disconnect. Keep the
-- authenticated DELETE grant for RLS, but require both membership and coordinator.
DROP POLICY IF EXISTS "Org members disconnect social accounts" ON public.social_accounts;
CREATE POLICY "Coordinators disconnect social accounts" ON public.social_accounts
  FOR DELETE TO authenticated
  USING (public.is_org_member(org_id) AND public.has_role(auth.uid(), 'coordinator'));
