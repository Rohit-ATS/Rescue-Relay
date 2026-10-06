CREATE OR REPLACE FUNCTION public.respond_to_match(_match_id uuid, _response public.match_status)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.matches%ROWTYPE; d public.donations%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT * INTO m FROM public.matches WHERE id = _match_id;
 IF m.id IS NULL THEN RAISE EXCEPTION 'Match not found'; END IF;
 SELECT * INTO d FROM public.donations WHERE id = m.donation_id FOR UPDATE;
 IF NOT public.has_role(auth.uid(), 'coordinator') AND NOT (public.has_role(auth.uid(), 'recipient') AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND organization_id = m.recipient_org_id)) THEN RAISE EXCEPTION 'This match belongs to another organization'; END IF;
 IF _response NOT IN ('accepted','declined','unsafe') THEN RAISE EXCEPTION 'Invalid response'; END IF;
 SELECT * INTO m FROM public.matches WHERE id = _match_id FOR UPDATE;
 IF m.status <> 'proposed' OR d.status NOT IN ('open','matched') THEN RAISE EXCEPTION 'This rescue is no longer available'; END IF;
 IF d.pickup_deadline <= now() THEN RAISE EXCEPTION 'Pickup window has expired'; END IF;
 IF _response = 'accepted' AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id=m.recipient_org_id AND o.verification_status='verified' AND o.capacity_lbs >= d.pounds AND d.category = ANY(o.accepted_categories) AND (d.storage_required='ambient' OR o.cold_storage)) THEN RAISE EXCEPTION 'Recipient does not meet the safety and capacity requirements'; END IF;
 UPDATE public.matches SET status=_response, responded_by=auth.uid(), responded_at=now() WHERE id=_match_id;
 IF _response='accepted' THEN
  UPDATE public.donations SET status='accepted' WHERE id=d.id;
  UPDATE public.matches SET status='declined', responded_at=now() WHERE donation_id=d.id AND id<>_match_id AND status='proposed';
 END IF;
 INSERT INTO public.rescue_events(donation_id,actor_user_id,event_type,detail) VALUES(d.id,auth.uid(),'recipient_' || _response::text,'Recipient marked match ' || _response::text);
END; $$;
CREATE OR REPLACE FUNCTION public.claim_delivery(_match_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.matches%ROWTYPE; d public.donations%ROWTYPE; existing public.deliveries%ROWTYPE; new_id uuid;
BEGIN
 IF auth.uid() IS NULL OR (NOT public.has_role(auth.uid(),'driver') AND NOT public.has_role(auth.uid(),'coordinator')) THEN RAISE EXCEPTION 'Driver access required'; END IF;
 SELECT * INTO m FROM public.matches WHERE id=_match_id;
 SELECT * INTO d FROM public.donations WHERE id=m.donation_id FOR UPDATE;
 IF m.id IS NULL OR m.status<>'accepted' OR d.status NOT IN ('accepted','driver_assigned') THEN RAISE EXCEPTION 'Accepted route not available'; END IF;
 IF d.pickup_deadline <= now() THEN RAISE EXCEPTION 'Pickup window has expired'; END IF;
 IF NOT public.has_role(auth.uid(),'coordinator') AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND availability AND food_safety_training AND vehicle_capacity_lbs >= d.pounds) THEN RAISE EXCEPTION 'Available trained driver with sufficient capacity required'; END IF;
 SELECT * INTO existing FROM public.deliveries WHERE match_id=_match_id FOR UPDATE;
 IF existing.driver_user_id IS NOT NULL AND existing.driver_user_id<>auth.uid() THEN RAISE EXCEPTION 'Route already assigned to another driver'; END IF;
 IF existing.picked_up_at IS NOT NULL OR existing.delivered_at IS NOT NULL THEN RAISE EXCEPTION 'Route already in progress'; END IF;
 INSERT INTO public.deliveries(match_id,driver_user_id,driver_name) VALUES(_match_id,auth.uid(),COALESCE((SELECT full_name FROM public.profiles WHERE id=auth.uid()),'Rescue driver')) ON CONFLICT(match_id) DO UPDATE SET driver_user_id=excluded.driver_user_id,driver_name=excluded.driver_name RETURNING id INTO new_id;
 UPDATE public.donations SET status='driver_assigned' WHERE id=d.id;
 INSERT INTO public.rescue_events(donation_id,actor_user_id,event_type,detail) VALUES(d.id,auth.uid(),'driver_assigned','Volunteer driver accepted the route');
 RETURN new_id;
END; $$;
CREATE OR REPLACE FUNCTION public.advance_delivery(_delivery_id uuid,_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE delivery public.deliveries%ROWTYPE; donation_ref uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT * INTO delivery FROM public.deliveries WHERE id=_delivery_id FOR UPDATE;
 IF delivery.id IS NULL THEN RAISE EXCEPTION 'Delivery not found'; END IF;
 IF NOT public.has_role(auth.uid(),'coordinator') AND delivery.driver_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Assigned driver access required'; END IF;
 SELECT donation_id INTO donation_ref FROM public.matches WHERE id=delivery.match_id;
 IF _action='pickup' THEN
  IF delivery.picked_up_at IS NOT NULL OR delivery.delivered_at IS NOT NULL THEN RAISE EXCEPTION 'Pickup already recorded'; END IF;
  UPDATE public.deliveries SET picked_up_at=now(),safety_acknowledged=true WHERE id=_delivery_id;
  UPDATE public.donations SET status='picked_up' WHERE id=donation_ref;
 ELSIF _action='deliver' THEN
  IF delivery.picked_up_at IS NULL THEN RAISE EXCEPTION 'Confirm pickup before delivery'; END IF;
  IF delivery.delivered_at IS NOT NULL THEN RAISE EXCEPTION 'Delivery already recorded'; END IF;
  UPDATE public.deliveries SET delivered_at=now() WHERE id=_delivery_id;
  UPDATE public.donations SET status='delivered' WHERE id=donation_ref;
 ELSE RAISE EXCEPTION 'Invalid action'; END IF;
 INSERT INTO public.rescue_events(donation_id,actor_user_id,event_type,detail) VALUES(donation_ref,auth.uid(),CASE WHEN _action='pickup' THEN 'picked_up' ELSE 'delivered' END,CASE WHEN _action='pickup' THEN 'Driver confirmed pickup and acknowledged safe handling' ELSE 'Driver confirmed delivery' END);
END; $$;
REVOKE ALL ON FUNCTION public.respond_to_match(uuid,public.match_status), public.claim_delivery(uuid), public.advance_delivery(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.respond_to_match(uuid,public.match_status), public.claim_delivery(uuid), public.advance_delivery(uuid,text) TO authenticated,service_role;
REVOKE UPDATE,DELETE ON public.matches,public.deliveries,public.donations FROM authenticated;
REVOKE INSERT ON public.deliveries FROM authenticated;
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE(full_name,phone,availability) ON public.profiles TO authenticated;
ALTER PUBLICATION supabase_realtime ADD TABLE public.organizations,public.rescue_events;
