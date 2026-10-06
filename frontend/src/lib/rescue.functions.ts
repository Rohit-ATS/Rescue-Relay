import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { donationSchema, onboardingSchema } from "@/lib/rescue-schemas";
import { scoreRescue } from "@/lib/rescue-scoring";
import { z } from 'zod';

export const getWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [profileResult, rolesResult, donationsResult, organizationsResult, matchesResult, deliveriesResult, eventsResult] = await Promise.all([
      context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
      context.supabase.from("user_roles").select("role").eq("user_id", context.userId),
      context.supabase.from("donations").select("*").order("pickup_deadline"),
      context.supabase.from("organizations").select("*").order("name"),
      context.supabase.from("matches").select("*").order("score", { ascending: false }),
      context.supabase.from("deliveries").select("*").order("created_at", { ascending: false }),
      context.supabase.from("rescue_events").select("*").order("created_at", { ascending: false }).limit(20),
    ]);
    const firstError = [profileResult, rolesResult, donationsResult, organizationsResult, matchesResult, deliveriesResult, eventsResult].find((result) => result.error)?.error;
    if (firstError) throw new Error(firstError.message);
    return {
      profile: profileResult.data,
      roles: rolesResult.data ?? [],
      donations: donationsResult.data ?? [],
      organizations: organizationsResult.data ?? [],
      matches: matchesResult.data ?? [],
      deliveries: deliveriesResult.data ?? [],
      events: eventsResult.data ?? [],
      userId: context.userId,
    };
  });

export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => onboardingSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("claim_initial_role", {
      _full_name: data.fullName,
      _role: data.role,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createDonation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => donationSchema.parse(input))
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
    const { data: donation, error } = await context.supabase.from("donations").insert({
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

    const { data: recipients } = await context.supabase.from("organizations").select("*").eq("type", "recipient").eq("verification_status", "verified");
    const createdAt = Date.now();
    const deadline = new Date(data.pickupDeadline).getTime();
    const candidates = (recipients ?? []).map((recipient) => {
      const distanceMiles = Math.max(0.8, Math.hypot(recipient.latitude - location.latitude, recipient.longitude - location.longitude) * 52);
      const result = scoreRescue({ name: recipient.name, distanceMiles, coldStorage: recipient.cold_storage, acceptsCategory: recipient.accepted_categories.includes(data.category), householdsServed: recipient.households_served, capacityLbs: recipient.capacity_lbs, requiredStorage: data.storageRequired, pounds: data.pounds, minutesRemaining: Math.max(0, (deadline - createdAt) / 60000) });
      return { donation_id: donation.id, recipient_org_id: recipient.id, score: result.score, explanation: result.explanation, status: "proposed" as const, eligible: result.eligible };
    }).filter((candidate) => candidate.eligible).map(({ eligible: _eligible, ...candidate }) => candidate);
    if (candidates.length) {
      const { error: matchError } = await context.supabase.from("matches").insert(candidates);
      if (matchError) throw new Error(matchError.message);
    }
    await context.supabase.from("rescue_events").insert({ donation_id: donation.id, actor_user_id: context.userId, event_type: "donation_posted", detail: `${data.pounds} lb ${data.category} posted · pickup located via ${location.provider}` });
    return { id: donation.id, matches: candidates.length };
  });

export const updateRescue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => zUpdate.parse(input))
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
 .inputValidator((input:unknown)=>z.object({id:z.string().uuid(),status:z.enum(['pending','verified','suspended'])}).parse(input))
 .handler(async({data,context})=>{
  const {data:allowed,error:roleError}=await context.supabase.rpc('has_role',{_user_id:context.userId,_role:'coordinator'});
  if(roleError||!allowed)throw new Error('Coordinator access required.');
  const {error}=await context.supabase.from('organizations').update({verification_status:data.status}).eq('id',data.id);
  if(error)throw new Error(error.message);return {ok:true};
 });
