-- Security hardening for onboarding and social Edge Function callers.
-- Organization membership is requested by a user and explicitly approved by a
-- coordinator; self-service role selection never grants tenant access.

CREATE TABLE public.organization_membership_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_role public.app_role NOT NULL CHECK (requested_role IN ('donor', 'recipient')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid
);
ALTER TABLE public.organization_membership_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.organization_membership_requests FROM PUBLIC, anon;
GRANT SELECT ON public.organization_membership_requests TO authenticated;
CREATE POLICY "Users view own membership requests" ON public.organization_membership_requests
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'coordinator'));

CREATE OR REPLACE FUNCTION public.claim_initial_role(_role public.app_role, _full_name text, _organization_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _role = 'coordinator' AND EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'coordinator') THEN RAISE EXCEPTION 'Coordinator access requires approval'; END IF;
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

CREATE OR REPLACE FUNCTION public.request_organization_membership(
  _role public.app_role,
  _full_name text,
  _organization_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE target_org public.organizations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _role NOT IN ('donor', 'recipient') THEN RAISE EXCEPTION 'Only donor and recipient memberships require approval'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()) THEN RAISE EXCEPTION 'Role already assigned'; END IF;
  IF char_length(trim(_full_name)) < 2 OR char_length(trim(_full_name)) > 100 THEN RAISE EXCEPTION 'Invalid name'; END IF;

  SELECT * INTO target_org FROM public.organizations WHERE id = _organization_id;
  IF target_org.id IS NULL OR target_org.type::text <> _role::text OR target_org.verification_status = 'suspended' THEN
    RAISE EXCEPTION 'Organization is not available for this role';
  END IF;

  INSERT INTO public.profiles (id, full_name, organization_id, onboarding_complete, vehicle_capacity_lbs, food_safety_training)
  VALUES (auth.uid(), trim(_full_name), NULL, false, 0, false)
  ON CONFLICT (id) DO UPDATE SET full_name = excluded.full_name, organization_id = NULL, onboarding_complete = false, updated_at = now();

  INSERT INTO public.organization_membership_requests (user_id, organization_id, requested_role, status, requested_at, reviewed_at, reviewed_by)
  VALUES (auth.uid(), _organization_id, _role, 'pending', now(), NULL, NULL)
  ON CONFLICT (user_id) DO UPDATE SET
    organization_id = excluded.organization_id,
    requested_role = excluded.requested_role,
    status = 'pending',
    requested_at = now(),
    reviewed_at = NULL,
    reviewed_by = NULL
  WHERE public.organization_membership_requests.status IN ('pending', 'rejected');
END;
$$;
REVOKE ALL ON FUNCTION public.request_organization_membership(public.app_role, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_organization_membership(public.app_role, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_organization_membership_request(_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE request_row public.organization_membership_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'coordinator') THEN
    RAISE EXCEPTION 'Coordinator access required';
  END IF;

  SELECT * INTO request_row FROM public.organization_membership_requests WHERE id = _request_id FOR UPDATE;
  IF request_row.id IS NULL OR request_row.status <> 'pending' THEN RAISE EXCEPTION 'Pending membership request not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = request_row.user_id) THEN RAISE EXCEPTION 'User already has a role'; END IF;

  UPDATE public.profiles
  SET organization_id = request_row.organization_id, onboarding_complete = true, updated_at = now()
  WHERE id = request_row.user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requester profile not found'; END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (request_row.user_id, request_row.requested_role);
  UPDATE public.organization_membership_requests
  SET status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
  WHERE id = request_row.id;
END;
$$;
REVOKE ALL ON FUNCTION public.approve_organization_membership_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_organization_membership_request(uuid) TO authenticated;
