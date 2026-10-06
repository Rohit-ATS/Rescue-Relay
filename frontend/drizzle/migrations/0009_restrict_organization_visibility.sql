DROP POLICY "Authenticated users view organizations" ON public.organizations;

CREATE POLICY "Users view involved organizations"
ON public.organizations
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'coordinator')
  OR id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.matches m
    JOIN public.donations d ON d.id = m.donation_id
    WHERE (m.recipient_org_id = organizations.id OR d.donor_org_id = organizations.id)
      AND public.can_view_rescue(d.id)
  )
);