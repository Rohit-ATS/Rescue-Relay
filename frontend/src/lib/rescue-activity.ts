/**
 * Derives "what am I involved in" from the saved workspace records.
 *
 * Every view already reads the same RLS-scoped workspace query, so a user's
 * activity feed is a projection of those rows rather than a separate table:
 * nothing can drift out of sync with the rescues themselves.
 */

/** How this user is involved in one rescue. Most hands-on commitment wins when several apply. */
export type ActivityRole = "driver" | "recipient" | "donor" | "coordinator";

/** Why a commitment is no longer live. */
export type ActivityOutcome = "delivered" | "expired" | "cancelled" | "declined" | "unsafe";

export type RescueActivity = {
  key: string;
  donationId: string;
  title: string;
  pounds: number;
  role: ActivityRole;
  /** Live work sits in `current`; anything finished or closed moves to `recent`. */
  phase: "current" | "recent";
  /** Where the rescue itself stands, in plain words. */
  stage: string;
  /** What happens next, or what this user must do. */
  nextStep: string;
  /** True when the rescue cannot advance until this user acts. */
  waitingOnYou: boolean;
  outcome?: ActivityOutcome;
  /** When this user's involvement began — not when the rescue was posted. */
  startedAt: string;
  completedAt?: string;
  deadline: string;
  matchId?: string;
  deliveryId?: string;
};

type DonationRow = {
  id: string;
  title: string;
  pounds: number | string;
  status: string;
  pickup_deadline: string;
  created_at: string;
  donor_user_id: string | null;
};

type MatchRow = {
  id: string;
  donation_id: string;
  recipient_org_id: string;
  status: string;
  created_at: string;
  responded_at?: string | null;
};

type DeliveryRow = {
  id: string;
  match_id: string;
  driver_user_id: string | null;
  picked_up_at?: string | null;
  delivered_at?: string | null;
  created_at: string;
};

export type ActivityInputs = {
  userId: string;
  organizationId: string | null;
  roles: string[];
  donations: DonationRow[];
  matches: MatchRow[];
  deliveries: DeliveryRow[];
};

/** A rescue in one of these states has stopped moving, whatever the user's part in it was. */
const CLOSED_STATUSES = new Set(["delivered", "expired", "cancelled"]);

const STAGE_LABELS: Record<string, string> = {
  open: "Posted, finding recipients",
  matched: "Awaiting recipient response",
  accepted: "Accepted, needs a driver",
  driver_assigned: "Driver assigned",
  picked_up: "In transit",
  delivered: "Delivered",
  expired: "Pickup window expired",
  cancelled: "Cancelled",
};

function stageLabel(status: string | null | undefined): string {
  if (!status) return "Status unknown";
  return STAGE_LABELS[status] ?? status.replaceAll("_", " ");
}

function toPounds(value: number | string): number {
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Builds this user's current and recent activities.
 *
 * One rescue yields at most one activity, labelled with the user's most hands-on
 * role in it, so a coordinator who also donated sees "donor" rather than a duplicate.
 */
export function buildActivityFeed(
  input: ActivityInputs,
  now: number = Date.now(),
): {
  current: RescueActivity[];
  recent: RescueActivity[];
} {
  const { userId, organizationId, roles, donations, matches, deliveries } = input;
  const isCoordinator = roles.includes("coordinator");

  const deliveryByMatch = new Map(deliveries.map((d) => [d.match_id, d]));
  const matchesByDonation = new Map<string, MatchRow[]>();
  for (const match of matches) {
    const list = matchesByDonation.get(match.donation_id);
    if (list) list.push(match);
    else matchesByDonation.set(match.donation_id, [match]);
  }

  const activities: RescueActivity[] = [];

  for (const donation of donations) {
    const donationMatches = matchesByDonation.get(donation.id) ?? [];
    const acceptedMatch = donationMatches.find((m) => m.status === "accepted");
    const acceptedDelivery = acceptedMatch ? deliveryByMatch.get(acceptedMatch.id) : undefined;
    const closed = CLOSED_STATUSES.has(donation.status);
    const expired = new Date(donation.pickup_deadline).getTime() < now;

    const base = {
      donationId: donation.id,
      title: donation.title,
      pounds: toPounds(donation.pounds),
      deadline: donation.pickup_deadline,
    };

    // Driver: the claim is the commitment, so only a delivery this user owns counts.
    const myDelivery = deliveries.find(
      (d) =>
        d.driver_user_id === userId && (acceptedMatch ? d.match_id === acceptedMatch.id : false),
    );
    if (myDelivery) {
      const delivered = Boolean(myDelivery.delivered_at);
      activities.push({
        ...base,
        key: `driver:${myDelivery.id}`,
        role: "driver",
        phase: delivered || closed ? "recent" : "current",
        stage: stageLabel(donation.status),
        waitingOnYou: !delivered && !closed,
        nextStep: delivered
          ? "Route complete"
          : myDelivery.picked_up_at
            ? "Confirm the drop-off to close this route"
            : "Collect the food and confirm pickup",
        ...(delivered
          ? { outcome: "delivered" as const }
          : closed
            ? { outcome: donation.status as ActivityOutcome }
            : {}),
        startedAt: myDelivery.created_at,
        ...(myDelivery.delivered_at ? { completedAt: myDelivery.delivered_at } : {}),
        matchId: myDelivery.match_id,
        deliveryId: myDelivery.id,
      });
      continue;
    }

    // Recipient: involvement begins when a match is offered to this user's organization.
    // Org membership alone is not enough — a donor's profile also carries an organization.
    const myMatch =
      organizationId && roles.includes("recipient")
        ? donationMatches.find((m) => m.recipient_org_id === organizationId)
        : undefined;
    if (myMatch) {
      const turnedDown = myMatch.status === "declined" || myMatch.status === "unsafe";
      const needsResponse = myMatch.status === "proposed" && !closed && !expired;
      activities.push({
        ...base,
        key: `recipient:${myMatch.id}`,
        role: "recipient",
        phase:
          turnedDown || closed || (expired && myMatch.status === "proposed") ? "recent" : "current",
        stage: turnedDown
          ? myMatch.status === "unsafe"
            ? "Flagged unsafe"
            : "Declined"
          : stageLabel(donation.status),
        waitingOnYou: needsResponse,
        nextStep: needsResponse
          ? "Accept or decline this offer"
          : turnedDown
            ? "No longer assigned to you"
            : donation.status === "delivered"
              ? "Received"
              : donation.status === "accepted"
                ? "Waiting for a driver to claim the route"
                : "Driver is handling the handoff",
        ...(turnedDown
          ? { outcome: (myMatch.status === "unsafe" ? "unsafe" : "declined") as ActivityOutcome }
          : closed
            ? { outcome: donation.status as ActivityOutcome }
            : expired && myMatch.status === "proposed"
              ? { outcome: "expired" as const }
              : {}),
        startedAt: myMatch.created_at,
        ...(myMatch.responded_at && turnedDown ? { completedAt: myMatch.responded_at } : {}),
        ...(donation.status === "delivered" && acceptedDelivery?.delivered_at
          ? { completedAt: acceptedDelivery.delivered_at }
          : {}),
        matchId: myMatch.id,
      });
      continue;
    }

    // Donor: posting the surplus is the commitment.
    if (donation.donor_user_id === userId) {
      activities.push({
        ...base,
        key: `donor:${donation.id}`,
        role: "donor",
        phase: closed ? "recent" : "current",
        stage: stageLabel(donation.status),
        waitingOnYou: false,
        nextStep:
          donation.status === "delivered"
            ? "Rescued"
            : donation.status === "open"
              ? donationMatches.length
                ? "Recipients are reviewing your offer"
                : "No eligible recipient matched yet"
              : donation.status === "accepted"
                ? "Accepted — waiting for a driver"
                : "Handoff in progress",
        ...(closed ? { outcome: donation.status as ActivityOutcome } : {}),
        startedAt: donation.created_at,
        ...(acceptedDelivery?.delivered_at ? { completedAt: acceptedDelivery.delivered_at } : {}),
      });
      continue;
    }

    // Coordinator: oversees rescues they are not otherwise party to.
    if (isCoordinator) {
      const stalled = !closed && expired;
      activities.push({
        ...base,
        key: `coordinator:${donation.id}`,
        role: "coordinator",
        phase: closed ? "recent" : "current",
        stage: stageLabel(donation.status),
        waitingOnYou: stalled,
        nextStep: stalled
          ? "Past its deadline — needs an exception"
          : closed
            ? "Closed"
            : "Monitoring",
        ...(closed ? { outcome: donation.status as ActivityOutcome } : {}),
        startedAt: donation.created_at,
        ...(acceptedDelivery?.delivered_at ? { completedAt: acceptedDelivery.delivered_at } : {}),
      });
    }
  }

  const time = (value: string | undefined) => (value ? new Date(value).getTime() : 0);

  // Anything blocked on this user floats up; otherwise the tightest deadline leads.
  const current = activities
    .filter((a) => a.phase === "current")
    .sort(
      (a, b) =>
        Number(b.waitingOnYou) - Number(a.waitingOnYou) || time(a.deadline) - time(b.deadline),
    );

  // Most recently finished first.
  const recent = activities
    .filter((a) => a.phase === "recent")
    .sort(
      (a, b) =>
        (time(b.completedAt) || time(b.deadline)) - (time(a.completedAt) || time(a.deadline)),
    );

  return { current, recent };
}
