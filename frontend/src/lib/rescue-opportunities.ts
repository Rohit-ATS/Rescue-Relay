/**
 * Turns the workspace records into volunteer opportunities near the viewer.
 *
 * An opportunity is a rescue a volunteer could sign up for right now, paired with
 * the food bank it would serve, so nobody has to accept a run without knowing where
 * the food is going.
 */
import {
  distanceMiles,
  estimatedDriveMinutes,
  estimatedRoadMiles,
  hasPosition,
  type Coords,
} from "@/lib/geo";

export type FoodBank = {
  id: string;
  name: string;
  /** donor, recipient or coordinator — the directory lists every kind. */
  type: string;
  address: string;
  latitude: number;
  longitude: number;
  coldStorage: boolean;
  capacityLbs: number;
  householdsServed: number;
  acceptedCategories: string[];
  verificationStatus: string;
  /** Contact details. Optional because migration 0011 may not be applied yet. */
  phone: string;
  contactEmail: string;
  website: string;
  hoursNote: string;
};

export type Opportunity = {
  donationId: string;
  title: string;
  category: string;
  pounds: number;
  storageRequired: string;
  pickupAddress: string;
  pickupDeadline: string;
  status: string;
  pickup: Coords;
  /** The food bank this run serves. Null while no recipient has accepted yet. */
  foodBank: FoodBank | null;
  /** True once a recipient accepted, so the drop-off is settled. */
  destinationConfirmed: boolean;
  /** Straight-line miles from the viewer to the pickup; undefined without a viewer position. */
  milesToPickup?: number;
  /** Estimated road miles for pickup to drop-off, once the food bank is known. */
  routeMiles?: number;
  /** Estimated minutes for the run, including both handoffs. */
  routeMinutes?: number;
  /** A driver can claim this run now. */
  claimable: boolean;
  /** The match a driver would claim against. */
  matchId?: string;
  /** Set once a driver has taken it. */
  claimedByUserId?: string;
  expired: boolean;
};

type DonationRow = {
  id: string;
  title: string;
  category: string;
  pounds: number | string;
  storage_required: string;
  pickup_address: string;
  pickup_deadline: string;
  status: string;
  latitude: number;
  longitude: number;
};

type MatchRow = {
  id: string;
  donation_id: string;
  recipient_org_id: string;
  status: string;
  score: number;
};

type OrganizationRow = {
  id: string;
  name: string;
  type: string;
  address: string;
  latitude: number;
  longitude: number;
  cold_storage: boolean;
  capacity_lbs: number;
  households_served: number;
  accepted_categories: string[];
  verification_status: string;
  // Added by migration 0011; absent from the row until it is applied.
  phone?: string | null;
  contact_email?: string | null;
  website?: string | null;
  hours_note?: string | null;
};

type DeliveryRow = { id: string; match_id: string; driver_user_id: string | null };

export type OpportunityInputs = {
  donations: DonationRow[];
  matches: MatchRow[];
  organizations: OrganizationRow[];
  deliveries: DeliveryRow[];
  /** The viewer's position, when they have shared it. Distances are omitted without one. */
  viewer?: Coords | null;
};

/** A rescue in one of these states is no longer open to new volunteers. */
const CLOSED_STATUSES = new Set(["delivered", "expired", "cancelled"]);

export function toFoodBank(org: OrganizationRow): FoodBank {
  return {
    id: org.id,
    name: org.name,
    type: org.type,
    address: org.address,
    latitude: org.latitude,
    longitude: org.longitude,
    coldStorage: org.cold_storage,
    capacityLbs: org.capacity_lbs,
    householdsServed: org.households_served,
    acceptedCategories: org.accepted_categories ?? [],
    verificationStatus: org.verification_status,
    phone: org.phone ?? "",
    contactEmail: org.contact_email ?? "",
    website: org.website ?? "",
    hoursNote: org.hours_note ?? "",
  };
}

/** Every partner organization, of any type, for the directory. */
export function listPartners(
  organizations: OrganizationRow[],
  viewer?: Coords | null,
): Array<FoodBank & { milesAway?: number }> {
  return organizations
    .map((org) => {
      const partner = toFoodBank(org);
      const milesAway =
        viewer && hasPosition(viewer) && hasPosition(partner)
          ? distanceMiles(viewer, partner)
          : undefined;
      return milesAway === undefined ? partner : { ...partner, milesAway };
    })
    .sort((a, b) => {
      const am = "milesAway" in a ? (a.milesAway as number) : Infinity;
      const bm = "milesAway" in b ? (b.milesAway as number) : Infinity;
      // Nearest first when a position is known; otherwise alphabetical.
      return am - bm || a.name.localeCompare(b.name);
    });
}

/** Just the food banks, for views that only concern recipients. */
export function listFoodBanks(
  organizations: OrganizationRow[],
  viewer?: Coords | null,
): Array<FoodBank & { milesAway?: number }> {
  return listPartners(
    organizations.filter((org) => org.type === "recipient"),
    viewer,
  );
}

/**
 * Open volunteer runs, nearest first.
 *
 * Runs already claimed by a driver are excluded, as are closed or expired rescues,
 * so the list only ever shows work somebody can actually sign up for.
 */
export function buildOpportunities(
  input: OpportunityInputs,
  now: number = Date.now(),
): Opportunity[] {
  const { donations, matches, organizations, deliveries, viewer } = input;
  const orgById = new Map(organizations.map((o) => [o.id, o]));
  const claimedMatchIds = new Map(
    deliveries.filter((d) => d.driver_user_id).map((d) => [d.match_id, d.driver_user_id as string]),
  );

  const matchesByDonation = new Map<string, MatchRow[]>();
  for (const match of matches) {
    const list = matchesByDonation.get(match.donation_id);
    if (list) list.push(match);
    else matchesByDonation.set(match.donation_id, [match]);
  }

  const viewerPosition = viewer && hasPosition(viewer) ? viewer : null;

  const results: Opportunity[] = [];

  for (const donation of donations) {
    if (CLOSED_STATUSES.has(donation.status)) continue;

    const donationMatches = matchesByDonation.get(donation.id) ?? [];
    const accepted = donationMatches.find((m) => m.status === "accepted");
    // Before anyone accepts, the best-scoring proposal is the likely destination.
    const likely =
      accepted ??
      [...donationMatches]
        .filter((m) => m.status === "proposed")
        .sort((a, b) => b.score - a.score)[0];
    const org = likely ? orgById.get(likely.recipient_org_id) : undefined;
    const foodBank = org ? toFoodBank(org) : null;

    const pickup: Coords = { latitude: donation.latitude, longitude: donation.longitude };
    const claimedBy = accepted ? claimedMatchIds.get(accepted.id) : undefined;
    const expired = new Date(donation.pickup_deadline).getTime() < now;

    const pounds = typeof donation.pounds === "string" ? Number(donation.pounds) : donation.pounds;

    results.push({
      donationId: donation.id,
      title: donation.title,
      category: donation.category,
      pounds: Number.isFinite(pounds) ? pounds : 0,
      storageRequired: donation.storage_required,
      pickupAddress: donation.pickup_address,
      pickupDeadline: donation.pickup_deadline,
      status: donation.status,
      pickup,
      foodBank,
      destinationConfirmed: Boolean(accepted),
      ...(viewerPosition && hasPosition(pickup)
        ? { milesToPickup: distanceMiles(viewerPosition, pickup) }
        : {}),
      ...(foodBank && hasPosition(pickup) && hasPosition(foodBank)
        ? {
            routeMiles: estimatedRoadMiles(pickup, foodBank),
            routeMinutes: estimatedDriveMinutes(pickup, foodBank),
          }
        : {}),
      // Only an accepted, unclaimed, unexpired run is open to a volunteer driver.
      claimable: Boolean(accepted) && !claimedBy && !expired,
      ...(accepted ? { matchId: accepted.id } : {}),
      ...(claimedBy ? { claimedByUserId: claimedBy } : {}),
      expired,
    });
  }

  return results.sort((a, b) => {
    // Claimable work first, then nearest, then the tightest deadline.
    if (a.claimable !== b.claimable) return Number(b.claimable) - Number(a.claimable);
    const am = a.milesToPickup ?? Infinity;
    const bm = b.milesToPickup ?? Infinity;
    if (am !== bm) return am - bm;
    return new Date(a.pickupDeadline).getTime() - new Date(b.pickupDeadline).getTime();
  });
}

export type PartnerSummary = {
  /** Rescues this partner has been part of, in any role. */
  totalRescues: number;
  /** Rescues that reached a confirmed delivery. */
  completedRescues: number;
  /** Pounds moved through completed rescues. */
  poundsMoved: number;
  /** Rescues still in flight. */
  activeRescues: number;
};

/**
 * What this partner has actually done, counted from the rescues the viewer can see.
 *
 * Numbers are therefore scoped by RLS: a coordinator sees the whole picture, a
 * volunteer sees only the rescues they were party to.
 */
export function summarizePartner(
  partnerId: string,
  input: Pick<OpportunityInputs, "donations" | "matches"> & {
    donorOrgIdByDonation?: Map<string, string | null>;
  },
): PartnerSummary {
  const asRecipient = new Set(
    input.matches
      .filter((m) => m.recipient_org_id === partnerId && m.status === "accepted")
      .map((m) => m.donation_id),
  );
  const asDonor = new Set(
    input.donations
      .filter((d) => input.donorOrgIdByDonation?.get(d.id) === partnerId)
      .map((d) => d.id),
  );
  const involved = input.donations.filter((d) => asRecipient.has(d.id) || asDonor.has(d.id));

  const completed = involved.filter((d) => d.status === "delivered");
  const poundsMoved = completed.reduce((sum, d) => {
    const n = typeof d.pounds === "string" ? Number(d.pounds) : d.pounds;
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  return {
    totalRescues: involved.length,
    completedRescues: completed.length,
    poundsMoved,
    activeRescues: involved.filter((d) => !CLOSED_STATUSES.has(d.status)).length,
  };
}
