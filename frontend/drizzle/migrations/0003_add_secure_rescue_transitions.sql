CREATE OR REPLACE FUNCTION public.claim_initial_role(_role public.app_role, _full_name text, _organization_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE assigned_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _role = 'coordinator' AND EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'coordinator') THEN RAISE EXCEPTION 'Coordinator access requires approval'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()) THEN RAISE EXCEPTION 'Role already assigned'; END IF;
  IF char_length(trim(_full_name)) < 2 OR char_length(trim(_full_name)) > 100 THEN RAISE EXCEPTION 'Invalid name'; END IF;
  assigned_org := _organization_id;
  IF assigned_org IS NULL AND _role = 'donor' THEN SELECT id INTO assigned_org FROM public.organizations WHERE type = 'donor' ORDER BY created_at LIMIT 1; END IF;
  IF assigned_org IS NULL AND _role = 'recipient' THEN SELECT id INTO assigned_org FROM public.organizations WHERE type = 'recipient' AND verification_status = 'verified' ORDER BY created_at LIMIT 1; END IF;
  INSERT INTO public.profiles (id, full_name, organization_id, onboarding_complete, vehicle_capacity_lbs, food_safety_training)
  VALUES (auth.uid(), trim(_full_name), assigned_org, true, CASE WHEN _role = 'driver' THEN 250 ELSE 0 END, _role = 'driver')
  ON CONFLICT (id) DO UPDATE SET full_name = excluded.full_name, organization_id = excluded.organization_id, onboarding_complete = true, updated_at = now();
  INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(), _role);
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_match(_match_id uuid, _response public.match_status)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE donation_ref uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'recipient') AND NOT public.has_role(auth.uid(), 'coordinator') THEN RAISE EXCEPTION 'Recipient access required'; END IF;
  IF _response NOT IN ('accepted','declined','unsafe') THEN RAISE EXCEPTION 'Invalid response'; END IF;
  UPDATE public.matches SET status = _response, responded_by = auth.uid(), responded_at = now() WHERE id = _match_id RETURNING donation_id INTO donation_ref;
  IF donation_ref IS NULL THEN RAISE EXCEPTION 'Match not found'; END IF;
  IF _response = 'accepted' THEN UPDATE public.donations SET status = 'accepted' WHERE id = donation_ref; END IF;
  INSERT INTO public.rescue_events(donation_id, actor_user_id, event_type, detail) VALUES (donation_ref, auth.uid(), 'recipient_' || _response::text, 'Recipient marked match ' || _response::text);
END;
$$;
GRANT EXECUTE ON FUNCTION public.respond_to_match(uuid, public.match_status) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_delivery(_match_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid; donation_ref uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'driver') AND NOT public.has_role(auth.uid(), 'coordinator') THEN RAISE EXCEPTION 'Driver access required'; END IF;
  SELECT donation_id INTO donation_ref FROM public.matches WHERE id = _match_id AND status = 'accepted';
  IF donation_ref IS NULL THEN RAISE EXCEPTION 'Accepted match not found'; END IF;
  INSERT INTO public.deliveries(match_id, driver_user_id, driver_name)
  VALUES (_match_id, auth.uid(), COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'Rescue driver'))
  ON CONFLICT (match_id) DO UPDATE SET driver_user_id = COALESCE(public.deliveries.driver_user_id, auth.uid())
  RETURNING id INTO new_id;
  UPDATE public.donations SET status = 'driver_assigned' WHERE id = donation_ref;
  INSERT INTO public.rescue_events(donation_id, actor_user_id, event_type, detail) VALUES (donation_ref, auth.uid(), 'driver_assigned', 'Volunteer driver accepted the route');
  RETURN new_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_delivery(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.advance_delivery(_delivery_id uuid, _action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE donation_ref uuid; assigned_driver uuid;
BEGIN
  SELECT m.donation_id, d.driver_user_id INTO donation_ref, assigned_driver FROM public.deliveries d JOIN public.matches m ON m.id = d.match_id WHERE d.id = _delivery_id;
  IF donation_ref IS NULL THEN RAISE EXCEPTION 'Delivery not found'; END IF;
  IF assigned_driver <> auth.uid() AND NOT public.has_role(auth.uid(), 'coordinator') THEN RAISE EXCEPTION 'Assigned driver access required'; END IF;
  IF _action = 'pickup' THEN
    UPDATE public.deliveries SET picked_up_at = now(), safety_acknowledged = true WHERE id = _delivery_id;
    UPDATE public.donations SET status = 'picked_up' WHERE id = donation_ref;
    INSERT INTO public.rescue_events(donation_id, actor_user_id, event_type, detail) VALUES (donation_ref, auth.uid(), 'picked_up', 'Pickup confirmed with safety acknowledgement');
  ELSIF _action = 'deliver' THEN
    UPDATE public.deliveries SET delivered_at = now(), recipient_confirmation = 'Received in safe condition' WHERE id = _delivery_id;
    UPDATE public.donations SET status = 'delivered' WHERE id = donation_ref;
    INSERT INTO public.rescue_events(donation_id, actor_user_id, event_type, detail) VALUES (donation_ref, auth.uid(), 'delivered', 'Delivery confirmed by recipient');
  ELSE RAISE EXCEPTION 'Invalid action'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.advance_delivery(uuid, text) TO authenticated;