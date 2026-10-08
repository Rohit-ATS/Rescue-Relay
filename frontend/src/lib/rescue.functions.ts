import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { donationSchema, membershipRequestIdSchema, onboardingSchema } from "@/lib/rescue-schemas";
import { scoreRescue } from "@/lib/rescue-scoring";
import { distanceMiles as haversineMiles } from "@/lib/geo";
import { z } from 'zod';

export const getWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [profileResult, rolesResult, donationsResult, organizationsResult, membershipRequestsResult, matchesResult, deliveriesResult, eventsResult] = await Promise.all([
      context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
      context.supabase.from("user_roles").select("role").eq("user_id", context.userId),
      context.supabase.from("donations").select("*").order("pickup_deadline"),
      context.supabase.from("organizations").select("*").order("name"),
      context.supabase.from("organization_membership_requests").select("*").eq("user_id", context.userId).maybeSingle(),
      context.supabase.from("matches").select("*").order("score", { ascending: false }),
      context.supabase.from("deliveries").select("*").order("created_at", { ascending: false }),
      context.supabase.from("rescue_events").select("*").order("created_at", { ascending: false }).limit(20),
    ]);
    const firstError = [profileResult, rolesResult, donationsResult, organizationsResult, membershipRequestsResult, matchesResult, deliveriesResult, eventsResult].find((result) => result.error)?.error;
    if (firstError) throw new Error(firstError.message);
    return {
      profile: profileResult.data,
      roles: rolesResult.data ?? [],
      donations: donationsResult.data ?? [],
      organizations: organizationsResult.data ?? [],
      membershipRequest: membershipRequestsResult.data,
      matches: matchesResult.data ?? [],
      deliveries: deliveriesResult.data ?? [],
      events: eventsResult.data ?? [],
      userId: context.userId,
    };
  });

export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => onboardingSchema.parse(input))
  .handler(async ({ data, context }) => {
    const requestMembership = data.role === "donor" || data.role === "recipient";
    const { error } = requestMembership
      ? await context.supabase.rpc("request_organization_membership", {
        _full_name: data.fullName,
        _organization_id: data.organizationId!,
        _role: data.role,
      })
      : await context.supabase.rpc("claim_initial_role", {
        _full_name: data.fullName,
        _role: data.role,
      });
    if (error) throw new Error(error.message);
    return { ok: true, pendingApproval: requestMembership };
  });

export const getPendingMembershipRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isCoordinator, error: roleError } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "coordinator" });
    if (roleError || !isCoordinator) throw new Error("Coordinator access required.");

    const { data: requests, error: requestsError } = await context.supabase
      .from("organization_membership_requests")
      .select("id, user_id, organization_id, requested_role, requested_at")
      .eq("status", "pending")
      .order("requested_at");
    if (requestsError) throw new Error(requestsError.message);

    const userIds = (requests ?? []).map((request) => request.user_id);
    const organizationIds = (requests ?? []).map((request) => request.organization_id);
    const [profilesResult, organizationsResult] = await Promise.all([
      userIds.length ? context.supabase.from("profiles").select("id, full_name").in("id", userIds) : Promise.resolve({ data: [], error: null }),
      organizationIds.length ? context.supabase.from("organizations").select("id, name").in("id", organizationIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (profilesResult.error || organizationsResult.error) throw new Error(profilesResult.error?.message ?? organizationsResult.error?.message);
    const namesByUser = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.full_name]));
    const namesByOrganization = new Map((organizationsResult.data ?? []).map((organization) => [organization.id, organization.name]));
    return (requests ?? []).map((request) => ({
      ...request,
      requesterName: namesByUser.get(request.user_id) ?? "Pending user",
      organizationName: namesByOrganization.get(request.organization_id) ?? "Unknown organization",
    }));
  });

export const approveMembershipRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => membershipRequestIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("approve_organization_membership_request", { _request_id: data.requestId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createDonation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => donationSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: canDonate } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "donor" });
    if (!canDonate) throw new Error("Only donor accounts can post donations.");
    if (new Date(data.pickupDeadline).getTime() <= Date.now()) throw new Error('Pickup deadline must be in the future.');
    const { data: profile } = await context.supabase.from("profiles").select("organization_id").eq("id", context.userId).maybeSingle();
    const { geocodePickupAddress, AddressNotFoundError } = await import("@/lib/geocode.server");
    let location;
    try {
      location = await geocodePickupAddress(data.pickupAddress);
    } catch (error) {
      // Both failure modes already carry donor-facing wording; rethrow as-is.
      if (error instanceof AddressNotFoundError) throw error;
      throw error instanceof Error ? error : new Error('Address lookup failed. Please try again later.');
    }
    // The caller identity above has already been authenticated, authorized, and used
    // to derive all protected fields. Persist through the server-only admin client so
    // browser-accessible database grants can stay read-only for workflow tables.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: donation, error } = await supabaseAdmin.from("donations").insert({
      donor_user_id: context.userId,
      donor_org_id: profile?.organization_id ?? null,
      title: data.title,
      category: data.category,
      pounds: data.pounds,
      servings: Math.round(data.pounds / 1.2),
      pickup_address: data.pickupAddress,
      pickup_deadline: data.pickupDeadline,
      storage_required: data.storageRequired,
      allergens: data.allergens,
      notes: data.notes,
      latitude: location.latitude,
      longitude: location.longitude,
    }).select("id").single();
    if (error || !donation) throw new Error(error?.message ?? "Donation could not be created.");

    const { data: recipients } = await supabaseAdmin.from("organizations").select("*").eq("type", "recipient").eq("verification_status", "verified");
    const createdAt = Date.now();
    const deadline = new Date(data.pickupDeadline).getTime();
    const candidates = (recipients ?? []).map((recipient) => {
      const distanceMiles = Math.max(0.8, haversineMiles({ latitude: recipient.latitude, longitude: recipient.longitude }, location));
      const result = scoreRescue({ name: recipient.name, distanceMiles, coldStorage: recipient.cold_storage, acceptsCategory: recipient.accepted_categories.includes(data.category), householdsServed: recipient.households_served, capacityLbs: recipient.capacity_lbs, requiredStorage: data.storageRequired, pounds: data.pounds, minutesRemaining: Math.max(0, (deadline - createdAt) / 60000) });
      return { donation_id: donation.id, recipient_org_id: recipient.id, score: result.score, explanation: result.explanation, status: "proposed" as const, eligible: result.eligible };
    }).filter((candidate) => candidate.eligible).map(({ eligible: _eligible, ...candidate }) => candidate);
    if (candidates.length) {
      const { error: matchError } = await supabaseAdmin.from("matches").insert(candidates);
      if (matchError) throw new Error(matchError.message);
    }
    const { error: eventError } = await supabaseAdmin.from("rescue_events").insert({ donation_id: donation.id, actor_user_id: context.userId, event_type: "donation_posted", detail: `${data.pounds} lb ${data.category} posted · pickup located via ${location.provider}` });
    if (eventError) throw new Error(eventError.message);
    return { id: donation.id, matches: candidates.length };
  });

export const updateRescue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => zUpdate.parse(input))
  .handler(async ({ data, context }) => {
    const { data: roleRows } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    const roles = new Set((roleRows ?? []).map((row) => row.role));
    if (data.action === "accept") {
      if (!roles.has("recipient") && !roles.has("coordinator")) throw new Error("Recipient access required.");
      const { error } = await context.supabase.rpc("respond_to_match", { _match_id: data.id, _response: "accepted" });
      if (error) throw new Error(error.message);
    } else if (data.action === "decline" || data.action === "unsafe") {
      if (!roles.has("recipient") && !roles.has("coordinator")) throw new Error("Recipient access required.");
      const response = data.action === "decline" ? "declined" : data.action;
      const { error } = await context.supabase.rpc("respond_to_match", { _match_id: data.id, _response: response });
      if (error) throw new Error(error.message);
    } else if (data.action === "claim") {
      if (!roles.has("driver") && !roles.has("coordinator")) throw new Error("Driver access required.");
      const { error } = await context.supabase.rpc("claim_delivery", { _match_id: data.id });
      if (error) throw new Error(error.message);
    } else if (data.action === "pickup" || data.action === "deliver") {
      if (!roles.has("driver") && !roles.has("coordinator")) throw new Error("Driver access required.");
      const { error } = await context.supabase.rpc("advance_delivery", { _delivery_id: data.id, _action: data.action });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

const zUpdate = z.object({ id: z.string().uuid(), action: z.enum(["accept", "decline", "unsafe", "claim", "pickup", "deliver"]) });

export const verifyPartner = createServerFn({method:'POST'})
 .middleware([requireSupabaseAuth])
 .validator((input:unknown)=>z.object({id:z.string().uuid(),status:z.enum(['pending','verified','suspended'])}).parse(input))
 .handler(async({data,context})=>{
  const {data:allowed,error:roleError}=await context.supabase.rpc('has_role',{_user_id:context.userId,_role:'coordinator'});
  if(roleError||!allowed)throw new Error('Coordinator access required.');
  const {error}=await context.supabase.from('organizations').update({verification_status:data.status}).eq('id',data.id);
  if(error)throw new Error(error.message);return {ok:true};
 });
