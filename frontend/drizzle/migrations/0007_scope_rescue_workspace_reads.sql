CREATE OR REPLACE FUNCTION public.can_view_rescue(_donation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
 SELECT 1 FROM public.donations d WHERE d.id=_donation_id AND (
 public.has_role(auth.uid(),'coordinator') OR
 (public.has_role(auth.uid(),'donor') AND (d.donor_user_id=auth.uid() OR d.donor_user_id IS NULL)) OR
 (public.has_role(auth.uid(),'recipient') AND EXISTS (SELECT 1 FROM public.matches m JOIN public.profiles p ON p.organization_id=m.recipient_org_id WHERE m.donation_id=d.id AND p.id=auth.uid())) OR
 (public.has_role(auth.uid(),'driver') AND (d.status IN ('open','matched','accepted','driver_assigned') OR EXISTS(SELECT 1 FROM public.deliveries x JOIN public.matches m ON m.id=x.match_id WHERE m.donation_id=d.id AND x.driver_user_id=auth.uid())))
 ));
$$;
REVOKE ALL ON FUNCTION public.can_view_rescue(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_rescue(uuid) TO authenticated,service_role;
ALTER POLICY "Authenticated users view donations" ON public.donations USING (public.can_view_rescue(id));
ALTER POLICY "Authenticated users view matches" ON public.matches USING (public.can_view_rescue(donation_id) AND (NOT public.has_role(auth.uid(),'recipient') OR public.has_role(auth.uid(),'coordinator') OR EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.organization_id=matches.recipient_org_id)));
ALTER POLICY "Authenticated users view deliveries" ON public.deliveries USING (EXISTS(SELECT 1 FROM public.matches m WHERE m.id=deliveries.match_id AND public.can_view_rescue(m.donation_id)));
ALTER POLICY "Authenticated users view rescue events" ON public.rescue_events USING (public.can_view_rescue(donation_id));
ALTER POLICY "Authenticated users create rescue events" ON public.rescue_events WITH CHECK (actor_user_id=auth.uid() AND public.can_view_rescue(donation_id));