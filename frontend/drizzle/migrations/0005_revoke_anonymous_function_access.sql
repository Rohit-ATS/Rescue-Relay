REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_initial_role(public.app_role, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.respond_to_match(uuid, public.match_status) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_delivery(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.advance_delivery(uuid, text) FROM anon;