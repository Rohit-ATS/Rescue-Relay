CREATE TYPE public.app_role AS ENUM ('donor', 'recipient', 'driver', 'coordinator');
CREATE TYPE public.organization_type AS ENUM ('donor', 'recipient', 'coordinator');
CREATE TYPE public.verification_status AS ENUM ('pending', 'verified', 'suspended');
CREATE TYPE public.donation_status AS ENUM ('open', 'matched', 'accepted', 'driver_assigned', 'picked_up', 'delivered', 'expired', 'cancelled');
CREATE TYPE public.match_status AS ENUM ('proposed', 'accepted', 'declined', 'unsafe');

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  type public.organization_type NOT NULL,
  verification_status public.verification_status NOT NULL DEFAULT 'pending',
  address text NOT NULL CHECK (char_length(address) <= 240),
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  cold_storage boolean NOT NULL DEFAULT false,
  capacity_lbs integer NOT NULL DEFAULT 0 CHECK (capacity_lbs >= 0),
  accepted_categories text[] NOT NULL DEFAULT '{}',
  households_served integer NOT NULL DEFAULT 0 CHECK (households_served >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  full_name text NOT NULL DEFAULT '' CHECK (char_length(full_name) <= 100),
  phone text NOT NULL DEFAULT '' CHECK (char_length(phone) <= 30),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  onboarding_complete boolean NOT NULL DEFAULT false,
  availability boolean NOT NULL DEFAULT true,
  vehicle_capacity_lbs integer NOT NULL DEFAULT 0 CHECK (vehicle_capacity_lbs >= 0),
  food_safety_training boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

CREATE POLICY "Authenticated users view organizations" ON public.organizations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Coordinators manage organizations" ON public.organizations FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'coordinator')) WITH CHECK (public.has_role(auth.uid(), 'coordinator'));
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.has_role(auth.uid(), 'coordinator'));
CREATE POLICY "Users create own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "Users view own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'coordinator'));

CREATE TABLE public.donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_user_id uuid,
  donor_org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
  category text NOT NULL CHECK (char_length(category) <= 60),
  pounds numeric(10,2) NOT NULL CHECK (pounds > 0 AND pounds <= 100000),
  servings integer CHECK (servings IS NULL OR servings >= 0),
  pickup_address text NOT NULL CHECK (char_length(pickup_address) <= 240),
  pickup_deadline timestamptz NOT NULL,
  storage_required text NOT NULL CHECK (storage_required IN ('ambient','refrigerated','frozen')),
  allergens text NOT NULL DEFAULT '' CHECK (char_length(allergens) <= 500),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  photo_url text,
  status public.donation_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.donations TO authenticated;
GRANT ALL ON public.donations TO service_role;
ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users view donations" ON public.donations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Donors create donations" ON public.donations FOR INSERT TO authenticated WITH CHECK (donor_user_id = auth.uid() AND public.has_role(auth.uid(), 'donor'));
CREATE POLICY "Donors and coordinators update donations" ON public.donations FOR UPDATE TO authenticated USING (donor_user_id = auth.uid() OR public.has_role(auth.uid(), 'coordinator')) WITH CHECK (donor_user_id = auth.uid() OR public.has_role(auth.uid(), 'coordinator'));

CREATE TABLE public.matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id uuid NOT NULL REFERENCES public.donations(id) ON DELETE CASCADE,
  recipient_org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  explanation text NOT NULL CHECK (char_length(explanation) <= 1000),
  status public.match_status NOT NULL DEFAULT 'proposed',
  responded_by uuid,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (donation_id, recipient_org_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matches TO authenticated;
GRANT ALL ON public.matches TO service_role;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users view matches" ON public.matches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Recipients and coordinators update matches" ON public.matches FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'recipient') OR public.has_role(auth.uid(), 'coordinator')) WITH CHECK (public.has_role(auth.uid(), 'recipient') OR public.has_role(auth.uid(), 'coordinator'));

CREATE TABLE public.deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL UNIQUE REFERENCES public.matches(id) ON DELETE CASCADE,
  driver_user_id uuid,
  driver_name text NOT NULL DEFAULT '',
  picked_up_at timestamptz,
  delivered_at timestamptz,
  pickup_proof_url text,
  delivery_proof_url text,
  recipient_confirmation text,
  safety_acknowledged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deliveries TO authenticated;
GRANT ALL ON public.deliveries TO service_role;
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users view deliveries" ON public.deliveries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Drivers and coordinators manage deliveries" ON public.deliveries FOR ALL TO authenticated USING (driver_user_id = auth.uid() OR public.has_role(auth.uid(), 'coordinator')) WITH CHECK (driver_user_id = auth.uid() OR public.has_role(auth.uid(), 'coordinator'));

CREATE TABLE public.rescue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id uuid NOT NULL REFERENCES public.donations(id) ON DELETE CASCADE,
  actor_user_id uuid,
  event_type text NOT NULL CHECK (char_length(event_type) <= 60),
  detail text NOT NULL DEFAULT '' CHECK (char_length(detail) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.rescue_events TO authenticated;
GRANT ALL ON public.rescue_events TO service_role;
ALTER TABLE public.rescue_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users view rescue events" ON public.rescue_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users create rescue events" ON public.rescue_events FOR INSERT TO authenticated WITH CHECK (actor_user_id = auth.uid());

CREATE INDEX donations_status_deadline_idx ON public.donations(status, pickup_deadline);
CREATE INDEX matches_donation_score_idx ON public.matches(donation_id, score DESC);
CREATE INDEX deliveries_driver_idx ON public.deliveries(driver_user_id);
CREATE INDEX rescue_events_donation_idx ON public.rescue_events(donation_id, created_at);

ALTER PUBLICATION supabase_realtime ADD TABLE public.donations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
ALTER PUBLICATION supabase_realtime ADD TABLE public.deliveries;