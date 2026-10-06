-- Social AI agents: connected accounts, encrypted tokens, agent settings, the
-- post/reply approval queue, inbound comments, and a job queue fed by rescue events.
--
-- Security model
--   * Org members (profiles.organization_id) and coordinators read their org's rows.
--   * OAuth tokens live in social_account_tokens, which has NO grants to anon or
--     authenticated — only the service role used by edge functions can touch it,
--     and the values are AES-GCM encrypted by the edge function before insert.
--   * Publishing is only possible through the social-publish edge function, which
--     checks approval; clients can approve/reject but cannot mark a post published.

CREATE OR REPLACE FUNCTION public.is_org_member(_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT _org_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND organization_id = _org_id)
    OR public.has_role(auth.uid(), 'coordinator')
  )
$$;
REVOKE ALL ON FUNCTION public.is_org_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Connected accounts (public metadata) + tokens (service role only)
-- ---------------------------------------------------------------------------
CREATE TABLE public.social_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('linkedin','instagram','x','google_business')),
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','needs_reauth','error')),
  display_name text NOT NULL DEFAULT '' CHECK (char_length(display_name) <= 160),
  handle text NOT NULL DEFAULT '' CHECK (char_length(handle) <= 160),
  -- Platform-side target: LinkedIn org/person URN, IG user id, X user id, GBP location path.
  external_id text NOT NULL DEFAULT '' CHECK (char_length(external_id) <= 300),
  profile_url text NOT NULL DEFAULT '' CHECK (char_length(profile_url) <= 500),
  scopes text[] NOT NULL DEFAULT '{}',
  last_error text NOT NULL DEFAULT '' CHECK (char_length(last_error) <= 1000),
  connected_by uuid,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, platform)
);
GRANT SELECT, DELETE ON public.social_accounts TO authenticated;
GRANT ALL ON public.social_accounts TO service_role;
ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members view social accounts" ON public.social_accounts
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "Org members disconnect social accounts" ON public.social_accounts
  FOR DELETE TO authenticated USING (public.is_org_member(org_id));

CREATE TABLE public.social_account_tokens (
  account_id uuid PRIMARY KEY REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  access_token_enc text NOT NULL,
  refresh_token_enc text,
  -- Instagram publishes with the linked Facebook Page token, kept separately.
  page_token_enc text,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.social_account_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.social_account_tokens TO service_role;
ALTER TABLE public.social_account_tokens ENABLE ROW LEVEL SECURITY;
-- No policies: RLS denies every non-service-role request.

CREATE TABLE public.social_oauth_states (
  state text PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  platform text NOT NULL,
  code_verifier text,
  return_to text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.social_oauth_states FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.social_oauth_states TO service_role;
ALTER TABLE public.social_oauth_states ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Per-org automation settings and per-agent configuration
-- ---------------------------------------------------------------------------
CREATE TABLE public.social_settings (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  require_approval boolean NOT NULL DEFAULT true,
  trigger_on_accept boolean NOT NULL DEFAULT true,
  trigger_on_delivery boolean NOT NULL DEFAULT true,
  trigger_on_urgent boolean NOT NULL DEFAULT true,
  inbox_sweep boolean NOT NULL DEFAULT true,
  default_image_url text NOT NULL DEFAULT '' CHECK (char_length(default_image_url) <= 500),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.social_settings TO authenticated;
GRANT ALL ON public.social_settings TO service_role;
ALTER TABLE public.social_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members view social settings" ON public.social_settings
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "Org members create social settings" ON public.social_settings
  FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id));
CREATE POLICY "Org members update social settings" ON public.social_settings
  FOR UPDATE TO authenticated USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));

CREATE TABLE public.agent_configs (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL CHECK (agent_id IN ('community-alert','perishable-dispatch','partner-relay','donor-gratitude','community-inbox')),
  enabled boolean NOT NULL DEFAULT true,
  tone text CHECK (tone IS NULL OR tone IN ('community','urgent','partner','storyteller','helpful')),
  platforms text[] NOT NULL DEFAULT '{}',
  signoff text CHECK (signoff IS NULL OR char_length(signoff) <= 300),
  extra_instructions text NOT NULL DEFAULT '' CHECK (char_length(extra_instructions) <= 1000),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, agent_id)
);
GRANT SELECT, INSERT, UPDATE ON public.agent_configs TO authenticated;
GRANT ALL ON public.agent_configs TO service_role;
ALTER TABLE public.agent_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members view agent configs" ON public.agent_configs
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "Org members create agent configs" ON public.agent_configs
  FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id));
CREATE POLICY "Org members update agent configs" ON public.agent_configs
  FOR UPDATE TO authenticated USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Inbound comments / mentions / reviews pulled by the Community Inbox agent
-- ---------------------------------------------------------------------------
CREATE TABLE public.social_inbox_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('linkedin','instagram','x','google_business')),
  kind text NOT NULL CHECK (kind IN ('comment','mention','review')),
  external_id text NOT NULL CHECK (char_length(external_id) <= 300),
  parent_external_id text NOT NULL DEFAULT '',
  author text NOT NULL DEFAULT '' CHECK (char_length(author) <= 160),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 5000),
  rating smallint CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','drafted','replied','ignored')),
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, platform, external_id)
);
GRANT SELECT, UPDATE ON public.social_inbox_items TO authenticated;
GRANT ALL ON public.social_inbox_items TO service_role;
ALTER TABLE public.social_inbox_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members view inbox" ON public.social_inbox_items
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "Org members triage inbox" ON public.social_inbox_items
  FOR UPDATE TO authenticated USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Posts and replies: draft -> pending_approval -> approved -> published | failed
-- ---------------------------------------------------------------------------
CREATE TABLE public.social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('linkedin','instagram','x','google_business')),
  kind text NOT NULL DEFAULT 'post' CHECK (kind IN ('post','reply')),
  donation_id uuid REFERENCES public.donations(id) ON DELETE SET NULL,
  inbox_item_id uuid REFERENCES public.social_inbox_items(id) ON DELETE SET NULL,
  trigger text NOT NULL DEFAULT 'manual',
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 5000),
  image_url text,
  status text NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval','approved','publishing','published','failed','rejected')),
  generated_by text NOT NULL DEFAULT 'claude' CHECK (generated_by IN ('claude','template','human')),
  model text NOT NULL DEFAULT '',
  guardrail_notes text[] NOT NULL DEFAULT '{}',
  dry_run boolean NOT NULL DEFAULT false,
  external_post_id text NOT NULL DEFAULT '',
  external_url text NOT NULL DEFAULT '',
  error text NOT NULL DEFAULT '' CHECK (char_length(error) <= 2000),
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX social_posts_org_created_idx ON public.social_posts(org_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_posts TO authenticated;
GRANT ALL ON public.social_posts TO service_role;
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members view posts" ON public.social_posts
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "Org members write drafts" ON public.social_posts
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(org_id) AND status = 'pending_approval' AND created_by = auth.uid());
CREATE POLICY "Org members edit unpublished posts" ON public.social_posts
  FOR UPDATE TO authenticated
  USING (public.is_org_member(org_id) AND status IN ('pending_approval','approved','failed','rejected'))
  WITH CHECK (public.is_org_member(org_id) AND status IN ('pending_approval','approved','rejected'));
CREATE POLICY "Org members delete unpublished posts" ON public.social_posts
  FOR DELETE TO authenticated
  USING (public.is_org_member(org_id) AND status <> 'published');

-- Clients may only move a post between draft states; publish metadata is server-owned.
CREATE OR REPLACE FUNCTION public.guard_social_post_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'service_role' OR current_user IN ('postgres','supabase_admin','service_role') THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF NEW.external_post_id IS DISTINCT FROM OLD.external_post_id
     OR NEW.external_url IS DISTINCT FROM OLD.external_url
     OR NEW.published_at IS DISTINCT FROM OLD.published_at
     OR NEW.dry_run IS DISTINCT FROM OLD.dry_run
     OR NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'Publish metadata can only be set by RescueRelay';
  END IF;
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    NEW.approved_by := auth.uid();
    NEW.approved_at := now();
  END IF;
  IF NEW.content IS DISTINCT FROM OLD.content AND OLD.generated_by <> 'human' THEN
    -- Human edits are tracked so the log shows the post was not sent verbatim from AI.
    NEW.guardrail_notes := array_append(NEW.guardrail_notes, 'Edited by a coordinator before approval');
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER social_posts_guard BEFORE UPDATE ON public.social_posts
  FOR EACH ROW EXECUTE FUNCTION public.guard_social_post_update();

-- ---------------------------------------------------------------------------
-- Agent job queue, filled by rescue-state triggers and drained by agent-run
-- ---------------------------------------------------------------------------
CREATE TABLE public.social_agent_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  trigger text NOT NULL,
  donation_id uuid REFERENCES public.donations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','skipped')),
  attempts smallint NOT NULL DEFAULT 0,
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (org_id, agent_id, trigger, donation_id)
);
CREATE INDEX social_agent_jobs_pending_idx ON public.social_agent_jobs(status, created_at) WHERE status = 'pending';
GRANT SELECT ON public.social_agent_jobs TO authenticated;
GRANT ALL ON public.social_agent_jobs TO service_role;
ALTER TABLE public.social_agent_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members view agent jobs" ON public.social_agent_jobs
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));

CREATE OR REPLACE FUNCTION public.enqueue_social_job(_org_id uuid, _agent_id text, _trigger text, _donation_id uuid, _setting text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  allowed boolean;
BEGIN
  IF _org_id IS NULL THEN RETURN; END IF;
  -- Orgs that never opened the Workflows page have no settings row: do nothing.
  EXECUTE format('SELECT %I FROM public.social_settings WHERE org_id = $1', _setting) INTO allowed USING _org_id;
  IF allowed IS NOT TRUE THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.agent_configs WHERE org_id = _org_id AND agent_id = _agent_id AND enabled = false) THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.social_accounts WHERE org_id = _org_id) THEN RETURN; END IF;
  INSERT INTO public.social_agent_jobs (org_id, agent_id, trigger, donation_id)
  VALUES (_org_id, _agent_id, _trigger, _donation_id)
  ON CONFLICT (org_id, agent_id, trigger, donation_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_social_job(uuid, text, text, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.social_jobs_from_donation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.pickup_deadline <= now() + interval '3 hours' THEN
    PERFORM public.enqueue_social_job(NEW.donor_org_id, 'perishable-dispatch', 'urgent_surplus', NEW.id, 'trigger_on_urgent');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER donations_social_jobs AFTER INSERT ON public.donations
  FOR EACH ROW EXECUTE FUNCTION public.social_jobs_from_donation();

CREATE OR REPLACE FUNCTION public.social_jobs_from_match()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    PERFORM public.enqueue_social_job(NEW.recipient_org_id, 'community-alert', 'rescue_accepted', NEW.donation_id, 'trigger_on_accept');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER matches_social_jobs AFTER UPDATE OF status ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.social_jobs_from_match();

CREATE OR REPLACE FUNCTION public.social_jobs_from_delivery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m record;
BEGIN
  IF NEW.delivered_at IS NOT NULL AND OLD.delivered_at IS NULL THEN
    SELECT recipient_org_id, donation_id INTO m FROM public.matches WHERE id = NEW.match_id;
    IF FOUND THEN
      PERFORM public.enqueue_social_job(m.recipient_org_id, 'donor-gratitude', 'rescue_delivered', m.donation_id, 'trigger_on_delivery');
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deliveries_social_jobs AFTER UPDATE OF delivered_at ON public.deliveries
  FOR EACH ROW EXECUTE FUNCTION public.social_jobs_from_delivery();

-- Atomically claim pending jobs so concurrent agent-run invocations never double-post.
CREATE OR REPLACE FUNCTION public.claim_social_jobs(_limit integer, _org_id uuid DEFAULT NULL)
RETURNS SETOF public.social_agent_jobs LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.social_agent_jobs j
     SET status = 'running', started_at = now(), attempts = j.attempts + 1
   WHERE j.id IN (
     SELECT id FROM public.social_agent_jobs
      WHERE status = 'pending' AND (_org_id IS NULL OR org_id = _org_id)
      ORDER BY created_at
      LIMIT greatest(1, least(_limit, 20))
      FOR UPDATE SKIP LOCKED)
  RETURNING j.*;
$$;
REVOKE ALL ON FUNCTION public.claim_social_jobs(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_social_jobs(integer, uuid) TO service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE
  public.social_accounts, public.social_posts, public.social_settings,
  public.agent_configs, public.social_inbox_items, public.social_agent_jobs;

