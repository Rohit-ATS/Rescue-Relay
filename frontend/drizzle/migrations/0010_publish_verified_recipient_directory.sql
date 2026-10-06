-- Volunteers must be able to browse food banks before they are involved in a rescue:
-- the Partners directory lists every verified recipient, and Opportunities names the
-- food bank a run would serve. Migration 0009 scoped organization reads to rescues the
-- user is already party to, which makes both impossible for a new volunteer.
--
-- Verified recipient organizations are public-facing nonprofits whose name, address and
-- capacity are directory information by nature. Organizations that are still pending or
-- have been suspended stay hidden, as do donor organizations, so this widens visibility
-- only for partners that coordinators have explicitly verified.

DROP POLICY "Users view involved organizations" ON public.organizations;

CREATE POLICY "Users view involved and verified organizations"
ON public.organizations
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'coordinator')
  OR id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
  OR (type = 'recipient' AND verification_status = 'verified')
  OR EXISTS (
    SELECT 1
    FROM public.matches m
    JOIN public.donations d ON d.id = m.donation_id
    WHERE (m.recipient_org_id = organizations.id OR d.donor_org_id = organizations.id)
      AND public.can_view_rescue(d.id)
  )
);
