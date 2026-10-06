CREATE OR REPLACE FUNCTION public.claim_initial_role(_role public.app_role, _full_name text, _organization_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _role = 'coordinator' THEN RAISE EXCEPTION 'Coordinator access requires approval'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()) THEN RAISE EXCEPTION 'Role already assigned'; END IF;
  IF char_length(trim(_full_name)) < 2 OR char_length(trim(_full_name)) > 100 THEN RAISE EXCEPTION 'Invalid name'; END IF;
  INSERT INTO public.profiles (id, full_name, organization_id, onboarding_complete, vehicle_capacity_lbs, food_safety_training)
  VALUES (auth.uid(), trim(_full_name), _organization_id, true, CASE WHEN _role = 'driver' THEN 250 ELSE 0 END, _role = 'driver')
  ON CONFLICT (id) DO UPDATE SET full_name = excluded.full_name, organization_id = excluded.organization_id, onboarding_complete = true, updated_at = now();
  INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(), _role);
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_initial_role(public.app_role, text, uuid) TO authenticated;

CREATE POLICY "Donors create candidate matches" ON public.matches FOR INSERT TO authenticated WITH CHECK (
  public.has_role(auth.uid(), 'donor') AND EXISTS (
    SELECT 1 FROM public.donations d WHERE d.id = donation_id AND d.donor_user_id = auth.uid()
  )
);
CREATE POLICY "Coordinators create matches" ON public.matches FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'coordinator'));
CREATE POLICY "Drivers create assigned deliveries" ON public.deliveries FOR INSERT TO authenticated WITH CHECK (driver_user_id = auth.uid() AND public.has_role(auth.uid(), 'driver'));
