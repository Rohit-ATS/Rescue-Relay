CREATE OR REPLACE FUNCTION public.claim_initial_role(_role public.app_role, _full_name text, _organization_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _role = 'coordinator' AND EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'coordinator') THEN
    RAISE EXCEPTION 'Coordinator access requires approval';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()) THEN RAISE EXCEPTION 'Role already assigned'; END IF;
  IF char_length(trim(_full_name)) < 2 OR char_length(trim(_full_name)) > 100 THEN RAISE EXCEPTION 'Invalid name'; END IF;
  INSERT INTO public.profiles (id, full_name, organization_id, onboarding_complete, vehicle_capacity_lbs, food_safety_training)
  VALUES (auth.uid(), trim(_full_name), _organization_id, true, CASE WHEN _role = 'driver' THEN 250 ELSE 0 END, _role = 'driver')
  ON CONFLICT (id) DO UPDATE SET full_name = excluded.full_name, organization_id = excluded.organization_id, onboarding_complete = true, updated_at = now();
  INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(), _role);
END;
$$;

CREATE POLICY "Users upload own rescue proofs" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'rescue-proofs' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users view own rescue proofs" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'rescue-proofs' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.has_role(auth.uid(), 'coordinator')));
CREATE POLICY "Users update own rescue proofs" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'rescue-proofs' AND (storage.foldername(name))[1] = auth.uid()::text) WITH CHECK (bucket_id = 'rescue-proofs' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users delete own rescue proofs" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'rescue-proofs' AND (storage.foldername(name))[1] = auth.uid()::text);