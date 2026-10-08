-- Remove the public hackathon privilege escalation and make OAuth transactions
-- short-lived. The local browser-only demo fallback remains available to evaluators.

DROP FUNCTION IF EXISTS public.claim_demo_access(text);

-- Remove role grants previously issued to anonymous sessions. Anonymous users
-- remain free to use the browser-only evaluator fallback, but never shared data.
DELETE FROM public.user_roles roles
USING auth.users users
WHERE roles.user_id = users.id
  AND users.raw_app_meta_data ->> 'provider' = 'anonymous';

DELETE FROM public.profiles profiles
USING auth.users users
WHERE profiles.id = users.id
  AND users.raw_app_meta_data ->> 'provider' = 'anonymous';

ALTER TABLE public.social_oauth_states
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

ALTER TABLE public.social_oauth_states
  ADD COLUMN IF NOT EXISTS authorization_code text;

UPDATE public.social_oauth_states
SET expires_at = created_at + interval '10 minutes'
WHERE expires_at IS NULL;

ALTER TABLE public.social_oauth_states
  ALTER COLUMN expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS social_oauth_states_expires_at_idx
  ON public.social_oauth_states (expires_at);

-- Facebook is already supported by the provider registry and MCP tools. Keep
-- the persisted-account constraints aligned so a real OAuth connection works.
ALTER TABLE public.social_accounts
  DROP CONSTRAINT IF EXISTS social_accounts_platform_check;
ALTER TABLE public.social_accounts
  ADD CONSTRAINT social_accounts_platform_check
  CHECK (platform IN ('linkedin', 'instagram', 'x', 'google_business', 'facebook'));

ALTER TABLE public.social_inbox_items
  DROP CONSTRAINT IF EXISTS social_inbox_items_platform_check;
ALTER TABLE public.social_inbox_items
  ADD CONSTRAINT social_inbox_items_platform_check
  CHECK (platform IN ('linkedin', 'instagram', 'x', 'google_business', 'facebook'));

ALTER TABLE public.social_posts
  DROP CONSTRAINT IF EXISTS social_posts_platform_check;
ALTER TABLE public.social_posts
  ADD CONSTRAINT social_posts_platform_check
  CHECK (platform IN ('linkedin', 'instagram', 'x', 'google_business', 'facebook'));

-- Approval configuration and approval state are coordinator controls.
DROP POLICY IF EXISTS "Org members create social settings" ON public.social_settings;
DROP POLICY IF EXISTS "Org members update social settings" ON public.social_settings;
CREATE POLICY "Coordinators manage social settings" ON public.social_settings
  FOR ALL TO authenticated
  USING (public.is_org_member(org_id) AND public.has_role(auth.uid(), 'coordinator'))
  WITH CHECK (public.is_org_member(org_id) AND public.has_role(auth.uid(), 'coordinator'));

DROP POLICY IF EXISTS "Org members edit unpublished posts" ON public.social_posts;
CREATE POLICY "Org members edit drafts; coordinators approve posts" ON public.social_posts
  FOR UPDATE TO authenticated
  USING (public.is_org_member(org_id) AND status IN ('pending_approval', 'approved', 'failed', 'rejected'))
  WITH CHECK (
    public.is_org_member(org_id)
    AND status IN ('pending_approval', 'approved', 'rejected')
    AND (status <> 'approved' OR public.has_role(auth.uid(), 'coordinator'))
  );
