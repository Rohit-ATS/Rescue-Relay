import { useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Clock3,
  MapPin,
  PackageCheck,
  Route as RouteIcon,
  ShieldCheck,
  Truck,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LiveMap, type MapRoute } from "@/components/rescuerelay/live-map";
import {
  appleDirectionsUrl,
  directionsUrl,
  formatMiles,
  formatMinutes,
  hasPosition,
} from "@/lib/geo";
import type { RescueActivity } from "@/lib/rescue-activity";
import type { FoodBank, Opportunity } from "@/lib/rescue-opportunities";

/** Shared timestamp format, matching the rest of the workspace. */
function date(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Shown when a list has nothing in it yet. */
export function Empty({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="border-y py-10">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{copy}</p>
    </div>
  );
}

/** One volunteer run: what it is, where it goes, who it serves, and the drive. */
export function OpportunityCard({
  opportunity,
  viewer,
  now,
  canDrive,
  busy,
  onOpen,
  onClaim,
}: {
  opportunity: Opportunity;
  viewer: { latitude: number; longitude: number } | null;
  now: number;
  canDrive: boolean;
  busy: boolean;
  onOpen: (id: string) => void;
  onClaim: (matchId: string) => void;
}) {
  const [showRoute, setShowRoute] = useState(false);
  const [routeSummary, setRouteSummary] = useState<{ distance: string; duration: string } | null>(
    null,
  );
  const o = opportunity;
  const bank = o.foodBank;
  const routable = Boolean(bank && hasPosition(o.pickup) && hasPosition(bank));
  const mapRoute = useMemo<MapRoute | undefined>(
    () =>
      routable && bank
        ? {
            origin: { lat: o.pickup.latitude, lng: o.pickup.longitude },
            destination: { lat: bank.latitude, lng: bank.longitude },
          }
        : undefined,
    [routable, bank, o.pickup],
  );
  const minutesLeft = Math.round((new Date(o.pickupDeadline).getTime() - now) / 60000);
  return (
    <article
      className={`rounded-md border bg-card p-5 ${o.claimable ? "border-l-4 border-l-primary" : ""}`}
    >
      <div className="flex flex-wrap justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-xl font-semibold">{o.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground capitalize">
            {o.category} · {o.storageRequired}
          </p>
        </div>
        <p className="shrink-0 font-semibold">{o.pounds.toLocaleString()} lb</p>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {o.claimable ? (
          <Badge className="bg-primary text-primary-foreground">Open for a driver</Badge>
        ) : o.expired ? (
          <Badge variant="outline" className="text-destructive">
            Window closed
          </Badge>
        ) : o.claimedByUserId ? (
          <Badge variant="outline">Driver assigned</Badge>
        ) : (
          <Badge variant="outline">
            {o.destinationConfirmed ? "Awaiting driver" : "Awaiting recipient"}
          </Badge>
        )}
        {o.milesToPickup !== undefined && (
          <Badge variant="outline">
            <MapPin className="mr-1 size-3" />
            {formatMiles(o.milesToPickup)} away
          </Badge>
        )}
        {!o.expired && minutesLeft <= 120 && (
          <Badge variant="outline" className="text-destructive">
            <Clock3 className="mr-1 size-3" />
            {minutesLeft <= 0 ? "Expiring" : `${minutesLeft} min left`}
          </Badge>
        )}
      </div>
      <dl className="mt-4 space-y-2 border-t pt-4 text-sm">
        <div className="flex gap-3">
          <dt className="w-20 shrink-0 text-muted-foreground">Pick up</dt>
          <dd className="min-w-0">
            {o.pickupAddress}
            <br />
            <span className="text-xs text-muted-foreground">by {date(o.pickupDeadline)}</span>
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-20 shrink-0 text-muted-foreground">Deliver</dt>
          <dd className="min-w-0">
            {bank ? (
              <>
                {bank.name}
                <br />
                <span className="text-xs text-muted-foreground">{bank.address}</span>
                {!o.destinationConfirmed && (
                  <span className="block text-xs text-muted-foreground">
                    Likely destination — not yet accepted
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">No recipient matched yet</span>
            )}
          </dd>
        </div>
      </dl>
      {bank && (
        <div className="mt-4 rounded-md border bg-muted/40 p-4">
          <p className="text-xs font-bold uppercase text-primary">About this food bank</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <Badge
              variant="outline"
              className={
                bank.verificationStatus === "verified"
                  ? "bg-success/10 text-success border-success/20"
                  : ""
              }
            >
              {bank.verificationStatus}
            </Badge>
            <Badge variant="outline">
              {bank.householdsServed.toLocaleString()} households served
            </Badge>
            <Badge variant="outline">
              {bank.coldStorage ? "Cold storage on site" : "No cold storage"}
            </Badge>
            <Badge variant="outline">{bank.capacityLbs.toLocaleString()} lb capacity</Badge>
          </div>
          {bank.acceptedCategories.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Accepts: {bank.acceptedCategories.join(", ")}
            </p>
          )}
        </div>
      )}
      {routable && bank && (
        <div className="mt-4">
          <Button variant="outline" size="sm" onClick={() => setShowRoute((v) => !v)}>
            <RouteIcon /> {showRoute ? "Hide driving route" : "Show driving route"}
          </Button>
          {showRoute && (
            <div className="mt-3 space-y-2">
              <LiveMap
                compact
                points={[
                  {
                    id: `${o.donationId}-p`,
                    lat: o.pickup.latitude,
                    lng: o.pickup.longitude,
                    label: o.pickupAddress,
                    kind: "donor",
                  },
                  {
                    id: `${o.donationId}-d`,
                    lat: bank.latitude,
                    lng: bank.longitude,
                    label: bank.name,
                    kind: "recipient",
                  },
                ]}
                route={mapRoute}
                onRouteSummary={setRouteSummary}
              />
              <p className="text-sm">
                <Truck className="mr-1 inline size-4" />
                {routeSummary ? (
                  <>
                    {routeSummary.distance} · about {routeSummary.duration} driving
                  </>
                ) : (
                  <>
                    about {o.routeMiles !== undefined ? formatMiles(o.routeMiles) : "—"} · roughly{" "}
                    {o.routeMinutes !== undefined ? formatMinutes(o.routeMinutes) : "—"} including
                    both handoffs <span className="text-muted-foreground">(estimated)</span>
                  </>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <a
                    href={directionsUrl(
                      viewer && hasPosition(viewer) ? viewer : o.pickup,
                      { latitude: bank.latitude, longitude: bank.longitude },
                      viewer && hasPosition(viewer) ? o.pickup : undefined,
                    )}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in Google Maps
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a
                    href={appleDirectionsUrl(o.pickup, {
                      latitude: bank.latitude,
                      longitude: bank.longitude,
                    })}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in Apple Maps
                  </a>
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button variant="outline" size="sm" onClick={() => onOpen(o.donationId)}>
          View rescue <ArrowRight />
        </Button>
        {canDrive && o.claimable && o.matchId && (
          <Button size="sm" disabled={busy} onClick={() => onClaim(o.matchId as string)}>
            <Truck /> Volunteer to drive
          </Button>
        )}
      </div>
    </article>
  );
}
const PARTNER_TYPE_LABELS: Record<string, string> = {
  donor: "Food donor",
  recipient: "Food bank",
  coordinator: "Coordinator",
};
const VERIFICATION_TONE: Record<string, string> = {
  verified: "bg-success/10 text-success border-success/20",
  pending: "bg-signal/10 text-signal-strong border-signal/20",
  suspended: "bg-destructive/10 text-destructive border-destructive/20",
};

/** One partner organization, with the detail a donor, driver or coordinator needs. */
export function PartnerCard({
  partner,
  coordinator,
  busy,
  onVerify,
}: {
  partner: FoodBank & { milesAway?: number };
  coordinator: boolean;
  busy: boolean;
  onVerify: (id: string, status: "verified" | "suspended") => void;
}) {
  const isRecipient = partner.type === "recipient";
  return (
    <article className="flex flex-col rounded-md border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold">{partner.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {PARTNER_TYPE_LABELS[partner.type] ?? partner.type}
          </p>
        </div>
        <Badge variant="outline" className={VERIFICATION_TONE[partner.verificationStatus] ?? ""}>
          {partner.verificationStatus}
        </Badge>
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-sm text-muted-foreground">
        <MapPin className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {partner.address}
          {partner.milesAway !== undefined && (
            <span className="block text-xs">{formatMiles(partner.milesAway)} from you</span>
          )}
        </span>
      </p>

      {/* Capacity and cold chain only mean something for an organization that receives food. */}
      {isRecipient ? (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Households served</dt>
            <dd className="mt-0.5 font-semibold">{partner.householdsServed.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Intake capacity</dt>
            <dd className="mt-0.5 font-semibold">{partner.capacityLbs.toLocaleString()} lb</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Cold chain</dt>
            <dd className="mt-0.5 font-semibold">
              {partner.coldStorage ? "Refrigerated" : "Ambient only"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Food accepted</dt>
            <dd className="mt-0.5 font-semibold capitalize">
              {partner.acceptedCategories.length
                ? partner.acceptedCategories.join(", ")
                : "Not specified"}
            </dd>
          </div>
        </dl>
      ) : (
        <dl className="mt-4 border-t pt-4 text-sm">
          <dt className="text-xs text-muted-foreground">On-site storage</dt>
          <dd className="mt-0.5 font-semibold">
            {partner.coldStorage ? "Refrigerated" : "Ambient only"}
          </dd>
        </dl>
      )}

      {coordinator && (
        <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
          {partner.verificationStatus !== "verified" && (
            <Button size="sm" disabled={busy} onClick={() => onVerify(partner.id, "verified")}>
              <ShieldCheck /> Verify
            </Button>
          )}
          {partner.verificationStatus !== "suspended" && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onVerify(partner.id, "suspended")}
            >
              <X /> Suspend
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

/** The partner directory: every organization in the network, filterable and searchable. */
export function PartnerDirectory({
  partners,
  coordinator,
  busy,
  locationShared,
  onVerify,
  onRequestLocation,
  locating,
}: {
  partners: Array<FoodBank & { milesAway?: number }>;
  coordinator: boolean;
  busy: boolean;
  locationShared: boolean;
  onVerify: (id: string, status: "verified" | "suspended") => void;
  onRequestLocation: () => void;
  locating: boolean;
}) {
  const [kind, setKind] = useState<"all" | "recipient" | "donor">("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(
    () => ({
      all: partners.length,
      recipient: partners.filter((p) => p.type === "recipient").length,
      donor: partners.filter((p) => p.type === "donor").length,
    }),
    [partners],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return partners.filter((p) => {
      if (kind !== "all" && p.type !== kind) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        p.address.toLowerCase().includes(needle) ||
        p.acceptedCategories.some((c) => c.toLowerCase().includes(needle))
      );
    });
  }, [partners, kind, query]);

  const filters: Array<[typeof kind, string]> = [
    ["all", `All partners (${counts.all})`],
    ["recipient", `Food banks (${counts.recipient})`],
    ["donor", `Donors (${counts.donor})`],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Partner directory</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every organization in the network{locationShared ? ", nearest first" : ""}. Food banks
            show the capacity and cold chain that decide what they can take.
          </p>
        </div>
        {!locationShared && (
          <Button variant="outline" size="sm" disabled={locating} onClick={onRequestLocation}>
            <MapPin /> {locating ? "Locating…" : "Use my location"}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-md border p-1">
          {filters.map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={kind === value ? "default" : "ghost"}
              className="h-8"
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, address or food type"
          aria-label="Search partners"
          className="h-9 max-w-xs"
        />
      </div>

      {visible.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((p) => (
            <PartnerCard
              key={p.id}
              partner={p}
              coordinator={coordinator}
              busy={busy}
              onVerify={onVerify}
            />
          ))}
        </div>
      ) : (
        <Empty
          title={query || kind !== "all" ? "No partners match that" : "No partners listed yet"}
          copy={
            query || kind !== "all"
              ? "Try a different search, or switch back to all partners."
              : "Verified organizations appear here as coordinators approve them."
          }
        />
      )}
    </div>
  );
}

/** Describes how long is left, or how long ago it closed, without a per-second re-render. */
function relativeTime(target: number, now: number) {
  const diff = Math.abs(target - now);
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "less than a minute";
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hr`;
  return `${Math.round(hours / 24)} days`;
}
const roleTone: Record<RescueActivity["role"], string> = {
  driver: "bg-info/10 text-info border-info/20",
  recipient: "bg-success/10 text-success border-success/20",
  donor: "bg-signal/10 text-signal-strong border-signal/20",
  coordinator: "bg-muted text-muted-foreground",
};
const outcomeTone: Record<string, string> = {
  delivered: "bg-success/10 text-success border-success/20",
  expired: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
  declined: "bg-muted text-muted-foreground",
  unsafe: "bg-destructive/10 text-destructive border-destructive/20",
};
/** One rescue this user is part of, with the next step and any action they can take inline. */
export function ActivityCard({
  activity,
  now,
  onOpen,
  onAct,
  busy,
}: {
  activity: RescueActivity;
  now: number;
  onOpen: (id: string) => void;
  onAct?: ((id: string, action: "pickup" | "deliver") => void) | undefined;
  busy?: boolean;
}) {
  const deadline = new Date(activity.deadline).getTime();
  const overdue = activity.phase === "current" && deadline < now;
  const driverAction =
    activity.phase === "current" && activity.role === "driver" && activity.deliveryId
      ? ((activity.nextStep.toLowerCase().includes("drop-off") ? "deliver" : "pickup") as
          "pickup" | "deliver")
      : undefined;
  return (
    <article
      className={`rounded-md border bg-card p-5 ${activity.waitingOnYou ? "border-l-4 border-l-primary" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={`capitalize ${roleTone[activity.role]}`}>
              {activity.role}
            </Badge>
            {activity.outcome ? (
              <Badge
                variant="outline"
                className={`capitalize ${outcomeTone[activity.outcome] ?? ""}`}
              >
                {activity.outcome}
              </Badge>
            ) : (
              <Badge variant="outline">{activity.stage}</Badge>
            )}
            {activity.waitingOnYou && (
              <Badge className="bg-primary text-primary-foreground">Waiting on you</Badge>
            )}
          </div>
          <h3 className="mt-2 truncate text-lg font-semibold">{activity.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{activity.nextStep}</p>
        </div>
        <p className="shrink-0 text-sm font-semibold">{activity.pounds.toLocaleString()} lb</p>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-xs text-muted-foreground">
        <p>
          {activity.phase === "current" ? (
            overdue ? (
              <span className="font-medium text-destructive">
                Pickup window closed {relativeTime(deadline, now)} ago
              </span>
            ) : (
              <>
                Pickup window closes in {relativeTime(deadline, now)} · {date(activity.deadline)}
              </>
            )
          ) : activity.completedAt ? (
            <>
              Closed {relativeTime(new Date(activity.completedAt).getTime(), now)} ago ·{" "}
              {date(activity.completedAt)}
            </>
          ) : (
            <>Deadline passed {date(activity.deadline)}</>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {driverAction && onAct && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onAct(activity.deliveryId as string, driverAction)}
            >
              {driverAction === "pickup" ? (
                <>
                  <PackageCheck /> Confirm pickup
                </>
              ) : (
                <>
                  <Check /> Confirm delivery
                </>
              )}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpen(activity.donationId)}>
            Open rescue <ArrowRight />
          </Button>
        </div>
      </div>
    </article>
  );
}
