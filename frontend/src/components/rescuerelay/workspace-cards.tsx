import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  Clock3,
  MapPin,
  PackageCheck,
  Route as RouteIcon,
  Search,
  Building2,
  ImageOff,
  Globe,
  Mail,
  Phone,
  ShieldCheck,
  Truck,
  X,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LiveMap, type MapRoute } from "@/components/rescuerelay/live-map";
import {
  appleDirectionsUrl,
  directionsUrl,
  formatMiles,
  formatMinutes,
  hasPosition,
} from "@/lib/geo";
import type { RescueActivity } from "@/lib/rescue-activity";
import type { FoodBank, Opportunity, PartnerSummary } from "@/lib/rescue-opportunities";
import { formatClock, formatMoment as date } from "@/lib/format";
import { countRescueStatuses, filterRescues } from "@/lib/rescue-opportunities";

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
/**
 * Clear, locale-safe timing.
 *
 * `toLocaleString` with a short month renders as "19:40 5 thg 10" under a Vietnamese
 * locale, which is hard to scan and ambiguous about ordering. The time remaining is
 * what a volunteer actually decides on, so it leads, with the clock time after it.
 */
function deadlineLabel(deadline: string, now: number) {
  const target = new Date(deadline).getTime();
  const clock = new Date(deadline).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (!Number.isFinite(target)) return { text: "No deadline", urgent: false, closed: false };
  if (target < now)
    return { text: `Closed ${relativeTime(target, now)} ago`, urgent: false, closed: true };
  return {
    text: `${relativeTime(target, now)} left · by ${clock}`,
    urgent: target - now <= 2 * 60 * 60 * 1000,
    closed: false,
  };
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
  routeActive,
  onToggleRoute,
}: {
  opportunity: Opportunity;
  viewer: { latitude: number; longitude: number } | null;
  now: number;
  canDrive: boolean;
  busy: boolean;
  onOpen: (id: string) => void;
  onClaim: (matchId: string) => void;
  /** True when the shared dispatch map is currently drawing this run. */
  routeActive: boolean;
  onToggleRoute: () => void;
}) {
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
  const deadline = deadlineLabel(o.pickupDeadline, now);

  const status = o.claimable
    ? { label: "Ready for a driver", className: "bg-primary text-primary-foreground" }
    : o.expired
      ? { label: "Window closed", className: "border-destructive/30 text-destructive" }
      : o.claimedByUserId
        ? { label: "Driver assigned", className: "" }
        : o.destinationConfirmed
          ? { label: "Awaiting driver", className: "" }
          : { label: "Awaiting recipient", className: "" };

  // One muted line beats a boxed panel: the Partners tab carries the full profile.
  const bankFacts = bank
    ? [
        bank.coldStorage ? "Cold chain" : "Ambient only",
        `${bank.capacityLbs.toLocaleString()} lb capacity`,
        `${bank.householdsServed.toLocaleString()} households`,
      ].join(" · ")
    : null;

  return (
    <article
      className={`rounded-md border bg-card ${o.claimable ? "border-l-4 border-l-primary" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 pt-4">
        <h3 className="min-w-0 flex-1 truncate text-base font-semibold">{o.title}</h3>
        <p className="shrink-0 text-base font-semibold tabular-nums">
          {o.pounds.toLocaleString()} lb
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2 text-xs">
        <Badge variant={o.claimable ? "default" : "outline"} className={status.className}>
          {status.label}
        </Badge>
        {o.milesToPickup !== undefined && (
          <Badge variant="outline" className="font-normal">
            <MapPin className="mr-1 size-3" />
            {formatMiles(o.milesToPickup)}
          </Badge>
        )}
        <Badge
          variant="outline"
          className={`font-normal ${deadline.urgent || deadline.closed ? "border-destructive/30 text-destructive" : ""}`}
        >
          <Clock3 className="mr-1 size-3" />
          {deadline.text}
        </Badge>
        <span className="text-muted-foreground capitalize">
          {o.category} · {o.storageRequired}
        </span>
      </div>

      {/* A two-stop strip reads as a journey; the old stacked definition list did not. */}
      <ol className="mt-3 border-t px-4 py-3 text-sm">
        <li className="flex gap-3">
          <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-signal" />
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Pick up
            </p>
            <p className="truncate">{o.pickupAddress}</p>
          </div>
        </li>
        <li aria-hidden="true" className="ml-[3px] h-3 w-px bg-border" />
        <li className="flex gap-3">
          <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Deliver
            </p>
            {bank ? (
              <>
                <p className="truncate font-medium">{bank.name}</p>
                <p className="truncate text-xs text-muted-foreground">{bank.address}</p>
                {bankFacts && <p className="truncate text-xs text-muted-foreground">{bankFacts}</p>}
                {!o.destinationConfirmed && (
                  <p className="text-xs text-muted-foreground">
                    Likely destination — not yet accepted
                  </p>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">No recipient matched yet</p>
            )}
          </div>
        </li>
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
        <p className="text-xs text-muted-foreground">
          {routable && o.routeMiles !== undefined ? (
            <>
              <Truck className="mr-1 inline size-3.5" />~{formatMiles(o.routeMiles)} ·{" "}
              {o.routeMinutes !== undefined ? formatMinutes(o.routeMinutes) : "—"} with handoffs
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-2">
          {routable && (
            <Button variant={routeActive ? "secondary" : "ghost"} size="sm" onClick={onToggleRoute}>
              <RouteIcon /> {routeActive ? "Hide route" : "Show route"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpen(o.donationId)}>
            Details <ArrowRight />
          </Button>
          {canDrive && o.claimable && o.matchId && (
            <Button size="sm" disabled={busy} onClick={() => onClaim(o.matchId as string)}>
              <Truck /> Volunteer
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
/** One partner organization, with the detail a donor, driver or coordinator needs. */
export function PartnerCard({
  partner,
  coordinator,
  busy,
  onVerify,
  onOpen,
}: {
  partner: FoodBank & { milesAway?: number };
  coordinator: boolean;
  busy: boolean;
  onVerify: (id: string, status: "verified" | "suspended") => void;
  onOpen: (partner: FoodBank & { milesAway?: number }) => void;
}) {
  const isRecipient = partner.type === "recipient";
  return (
    <article className="flex flex-col overflow-hidden rounded-md border bg-card transition-colors hover:border-primary/40">
      <PartnerPhoto partner={partner} />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold">
              <button
                type="button"
                onClick={() => onOpen(partner)}
                className="text-left hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {partner.name}
              </button>
            </h3>
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
        <Button
          variant="link"
          size="sm"
          className="mt-4 h-auto justify-start self-start px-0"
          onClick={() => onOpen(partner)}
          aria-label={`View details for ${partner.name}`}
        >
          View details <ArrowRight />
        </Button>
      </div>
    </article>
  );
}

/**
 * The band across the top of a partner card: the site itself, so a driver has
 * something to recognise on arrival and a donor can scan the directory by sight
 * rather than reading every name.
 *
 * Deliberately not a control. The name and the "View details" button already open
 * this partner, and a third target carrying the same accessible name would be a
 * duplicate stop for anyone on a keyboard or a screen reader.
 *
 * A partner without a photo is an ordinary state, not a gap — it gets a drawn
 * placeholder of the same height, so a grid of cards keeps its rhythm whether or
 * not photos have been supplied. A photo that fails to load falls back to that
 * same placeholder rather than leaving a torn image behind.
 */
function PartnerPhoto({ partner }: { partner: FoodBank }) {
  const [broken, setBroken] = useState(false);
  const label = PARTNER_TYPE_LABELS[partner.type] ?? partner.type;

  if (!partner.photoUrl || broken) {
    return (
      <div
        aria-hidden="true"
        className="flex aspect-[16/7] w-full flex-col items-center justify-center gap-1 bg-muted text-muted-foreground"
      >
        {broken ? <ImageOff className="size-6" /> : <Building2 className="size-6" />}
        <span className="text-xs">{broken ? "Photo unavailable" : "No photo yet"}</span>
      </div>
    );
  }

  return (
    <img
      src={partner.photoUrl}
      alt={`${partner.name}, ${label.toLowerCase()}`}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
      className="aspect-[16/7] w-full bg-muted object-cover"
    />
  );
}

type RescueDetailRow = BoardRescue & {
  allergens?: string;
  notes?: string;
  storage_required?: string;
  latitude?: number;
  longitude?: number;
};

type DetailMatch = {
  id: string;
  recipient_org_id: string;
  score: number;
  explanation: string;
  status: string;
};
type DetailOrg = { id: string; name: string; address: string; latitude: number; longitude: number };
type DetailDelivery = {
  driver_name?: string;
  picked_up_at?: string | null;
  delivered_at?: string | null;
} | null;

/** A labelled fact in the rescue dialog. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

/**
 * The whole rescue, in place.
 *
 * Opening a rescue used to move the viewer to another section, losing their place on
 * the board. Everything the overview panel shows is here instead, with a way through
 * to the full workspace for anyone who wants it.
 */
export function RescueDetailDialog({
  rescue,
  matches,
  organizations,
  delivery,
  statusTone,
  now,
  onClose,
  onOpenWorkspace,
}: {
  rescue: RescueDetailRow | null;
  matches: DetailMatch[];
  organizations: DetailOrg[];
  delivery: DetailDelivery;
  statusTone: Record<string, string>;
  now: number;
  onClose: () => void;
  onOpenWorkspace: (id: string) => void;
}) {
  if (!rescue) return null;

  const accepted = matches.find((m) => m.status === "accepted");
  const recipient = organizations.find((o) => o.id === accepted?.recipient_org_id);
  const deadline = deadlineLabel(rescue.pickup_deadline, now);
  const located = hasPosition({ latitude: rescue.latitude ?? 0, longitude: rescue.longitude ?? 0 });

  const points = [
    ...(located
      ? [
          {
            id: `${rescue.id}-pickup`,
            lat: rescue.latitude as number,
            lng: rescue.longitude as number,
            label: rescue.pickup_address,
            kind: "donor" as const,
          },
        ]
      : []),
    ...(recipient && hasPosition(recipient)
      ? [
          {
            id: recipient.id,
            lat: recipient.latitude,
            lng: recipient.longitude,
            label: recipient.name,
            kind: "recipient" as const,
          },
        ]
      : []),
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={statusTone[rescue.status] ?? ""}>
              {rescue.status.replaceAll("_", " ")}
            </Badge>
            <Badge
              variant="outline"
              className={
                deadline.urgent || deadline.closed ? "border-destructive/30 text-destructive" : ""
              }
            >
              <Clock3 className="mr-1 size-3" />
              {deadline.text}
            </Badge>
          </div>
          <DialogTitle className="mt-2 text-2xl">{rescue.title}</DialogTitle>
          <DialogDescription>
            {Number(rescue.pounds).toLocaleString()} lb · {rescue.category}
            {rescue.storage_required ? ` · ${rescue.storage_required}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 overflow-y-auto px-6 py-5">
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-primary">Pickup</h3>
            <dl className="mt-3 grid gap-4 sm:grid-cols-2">
              <Fact label="Address">{rescue.pickup_address}</Fact>
              <Fact label="Collect by">{date(rescue.pickup_deadline)}</Fact>
            </dl>
            {points.length > 0 && (
              <div className="mt-4">
                <LiveMap compact points={points} />
              </div>
            )}
          </section>

          {(rescue.allergens || rescue.notes) && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-primary">
                Food safety
              </h3>
              <dl className="mt-3 space-y-3">
                {rescue.allergens && <Fact label="Allergens">{rescue.allergens}</Fact>}
                {rescue.notes && <Fact label="Handling notes">{rescue.notes}</Fact>}
              </dl>
            </section>
          )}

          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-primary">
              Recipient matches
              <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground">
                {matches.length}
              </span>
            </h3>
            {matches.length ? (
              <ul className="mt-3 space-y-2">
                {matches.map((m) => {
                  const org = organizations.find((o) => o.id === m.recipient_org_id);
                  return (
                    <li key={m.id} className="rounded-md border bg-muted/30 p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-medium">{org?.name ?? "Recipient"}</p>
                        <p className="text-sm font-semibold tabular-nums">
                          {m.score}
                          <span className="text-xs font-normal text-muted-foreground">/100</span>
                        </p>
                      </div>
                      <p className="mt-0.5 text-xs capitalize text-muted-foreground">{m.status}</p>
                      <p className="mt-1.5 text-xs text-muted-foreground">{m.explanation}</p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                No verified recipient matches this yet.
              </p>
            )}
          </section>

          {delivery && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-primary">Handoff</h3>
              <dl className="mt-3 grid gap-4 sm:grid-cols-3">
                <Fact label="Driver">{delivery.driver_name || "Unassigned"}</Fact>
                <Fact label="Picked up">
                  {delivery.picked_up_at ? date(delivery.picked_up_at) : "Not yet"}
                </Fact>
                <Fact label="Delivered">
                  {delivery.delivered_at ? date(delivery.delivered_at) : "Not yet"}
                </Fact>
              </dl>
            </section>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t px-6 py-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            onClick={() => {
              onClose();
              onOpenWorkspace(rescue.id);
            }}
          >
            Open in workspace <ArrowRight />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type BoardRescue = {
  id: string;
  title: string;
  category: string;
  pounds: number | string;
  status: string;
  pickup_address: string;
  pickup_deadline: string;
};

const BOARD_FILTERS: Array<[string, string]> = [
  ["all", "All"],
  ["active", "In progress"],
  ["delivered", "Delivered"],
  ["closed", "Closed"],
];

/** Every rescue the viewer can see, searchable and filterable by status. */
export function RelayBoard({
  rescues,
  statusTone,
  onOpen,
}: {
  rescues: BoardRescue[];
  statusTone: Record<string, string>;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");

  const counts = useMemo(() => countRescueStatuses(rescues), [rescues]);
  const visible = useMemo(
    () => filterRescues(rescues, { query, status }),
    [rescues, query, status],
  );

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">
          Relay board
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {visible.length === rescues.length
              ? `${rescues.length} rescue${rescues.length === 1 ? "" : "s"}`
              : `${visible.length} of ${rescues.length}`}
          </span>
        </h2>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search rescues"
              aria-label="Search rescues"
              className="h-9 w-56 pl-8"
            />
          </div>
          <div className="flex flex-wrap gap-1 rounded-md border p-1">
            {BOARD_FILTERS.map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={status === value ? "default" : "ghost"}
                className="h-7"
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
              >
                {label}
                <span className="ml-1 opacity-70 tabular-nums">{counts[value] ?? 0}</span>
              </Button>
            ))}
          </div>
        </div>
      </div>

      {visible.length ? (
        <div className="divide-y border-y">
          {visible.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="min-w-0">
                <p className="truncate font-medium">{d.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {Number(d.pounds)} lb · {date(d.pickup_deadline)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="outline" className={statusTone[d.status] ?? ""}>
                  {d.status.replaceAll("_", " ")}
                </Badge>
                <Button size="sm" variant="ghost" onClick={() => onOpen(d.id)}>
                  Details <ArrowRight />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          title={rescues.length ? "No rescues match that" : "No rescues yet"}
          copy={
            rescues.length
              ? "Try a different search, or switch the status filter back to All."
              : "Posted donations will appear here."
          }
        />
      )}
    </section>
  );
}

/** The opportunities list, with filters so a volunteer can find work they can take. */
export function OpportunityBoard({
  opportunities,
  viewer,
  now,
  canDrive,
  busy,
  onOpen,
  onClaim,
  onRouteChange,
}: {
  opportunities: Opportunity[];
  viewer: { latitude: number; longitude: number } | null;
  now: number;
  canDrive: boolean;
  busy: boolean;
  onOpen: (id: string) => void;
  onClaim: (matchId: string) => void;
  /** Hands the shared dispatch map the run to draw, or null to show everything. */
  onRouteChange: (opportunity: Opportunity | null) => void;
}) {
  const [filter, setFilter] = useState<"open" | "claimable" | "awaiting" | "all">("open");
  const [routeId, setRouteId] = useState("");

  const counts = useMemo(
    () => ({
      all: opportunities.length,
      open: opportunities.filter((o) => !o.expired).length,
      claimable: opportunities.filter((o) => o.claimable).length,
      awaiting: opportunities.filter((o) => !o.expired && !o.destinationConfirmed).length,
    }),
    [opportunities],
  );

  const visible = useMemo(() => {
    if (filter === "all") return opportunities;
    if (filter === "claimable") return opportunities.filter((o) => o.claimable);
    if (filter === "awaiting")
      return opportunities.filter((o) => !o.expired && !o.destinationConfirmed);
    return opportunities.filter((o) => !o.expired);
  }, [opportunities, filter]);

  const filters: Array<[typeof filter, string, number]> = [
    ["open", "Still open", counts.open],
    ["claimable", "Ready to drive", counts.claimable],
    ["awaiting", "Needs a recipient", counts.awaiting],
    ["all", "Everything", counts.all],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-md border p-1">
        {filters.map(([value, label, count]) => (
          <Button
            key={value}
            size="sm"
            variant={filter === value ? "default" : "ghost"}
            className="h-8"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label} <span className="ml-1 opacity-70 tabular-nums">{count}</span>
          </Button>
        ))}
      </div>

      {visible.length ? (
        <div className="space-y-3">
          {visible.map((o) => (
            <OpportunityCard
              key={o.donationId}
              opportunity={o}
              routeActive={routeId === o.donationId}
              onToggleRoute={() => {
                const next = routeId === o.donationId ? "" : o.donationId;
                setRouteId(next);
                onRouteChange(next ? o : null);
              }}
              viewer={viewer}
              now={now}
              canDrive={canDrive}
              busy={busy}
              onOpen={onOpen}
              onClaim={onClaim}
            />
          ))}
        </div>
      ) : (
        <Empty
          title={
            filter === "claimable" ? "Nothing ready to drive right now" : "No opportunities here"
          }
          copy={
            filter === "open" || filter === "claimable"
              ? "New donations appear here as partners post them. Try \u201cEverything\u201d to see closed rescues."
              : "New donations appear here as partners post them."
          }
        />
      )}
    </div>
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

/** A labelled figure in the record strip. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** One contact row. Rendered only when there is something to show. */
function ContactRow({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <dt className="flex w-20 shrink-0 items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** Everything known about one partner: how to reach them, where they are, what they have moved. */
export function PartnerDetail({
  partner,
  summary,
  viewer,
  locationStatus,
  onRequestLocation,
  coordinator,
  busy,
  onVerify,
  onClose,
}: {
  partner: (FoodBank & { milesAway?: number }) | null;
  summary: PartnerSummary | null;
  viewer: { latitude: number; longitude: number } | null;
  locationStatus: "idle" | "prompting" | "granted" | "denied" | "unavailable";
  onRequestLocation: () => void;
  coordinator: boolean;
  busy: boolean;
  onVerify: (id: string, status: "verified" | "suspended") => void;
  onClose: () => void;
}) {
  if (!partner) return null;
  const isRecipient = partner.type === "recipient";
  const located = hasPosition(partner);
  const destination = { latitude: partner.latitude, longitude: partner.longitude };
  const origin = viewer && hasPosition(viewer) ? viewer : destination;
  const [routeSummary, setRouteSummary] = useState<{
    distance: string;
    duration: string;
    followsRoads?: boolean;
  } | null>(null);
  const hasContact = Boolean(
    partner.phone || partner.contactEmail || partner.hoursNote || partner.website,
  );

  useEffect(() => {
    if (!located || !viewer || !hasPosition(viewer)) {
      setRouteSummary(null);
      return;
    }

    setRouteSummary(null);
  }, [
    destination.latitude,
    destination.longitude,
    located,
    partner.id,
    viewer?.latitude,
    viewer?.longitude,
  ]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{PARTNER_TYPE_LABELS[partner.type] ?? partner.type}</Badge>
            <Badge
              variant="outline"
              className={VERIFICATION_TONE[partner.verificationStatus] ?? ""}
            >
              {partner.verificationStatus}
            </Badge>
          </div>
          <DialogTitle className="mt-2 text-2xl">{partner.name}</DialogTitle>
          {/* The address lives here only; repeating it in the contact list was noise. */}
          <DialogDescription className="flex items-start gap-1.5">
            <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              {partner.address}
              {partner.milesAway !== undefined && ` · ${formatMiles(partner.milesAway)} from you`}
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* What this partner has actually done leads, rather than sitting below the fold. */}
        {summary && (
          <dl className="grid grid-cols-2 gap-4 rounded-md border bg-muted/40 p-4 sm:grid-cols-4">
            <Stat label="Rescues" value={String(summary.totalRescues)} />
            <Stat label="Completed" value={String(summary.completedRescues)} />
            <Stat label="In progress" value={String(summary.activeRescues)} />
            <Stat
              label="Food moved"
              value={`${Math.round(summary.poundsMoved).toLocaleString()} lb`}
            />
          </dl>
        )}

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-6">
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-primary">Contact</h3>
              {hasContact ? (
                <dl className="mt-3 space-y-2.5 text-sm">
                  {partner.phone && (
                    <ContactRow icon={Phone} label="Phone">
                      <a
                        className="font-medium underline underline-offset-2"
                        href={`tel:${partner.phone.replace(/[^+\d]/g, "")}`}
                      >
                        {partner.phone}
                      </a>
                    </ContactRow>
                  )}
                  {partner.contactEmail && (
                    <ContactRow icon={Mail} label="Email">
                      <a
                        className="font-medium underline underline-offset-2"
                        href={`mailto:${partner.contactEmail}`}
                      >
                        {partner.contactEmail}
                      </a>
                    </ContactRow>
                  )}
                  {partner.hoursNote && (
                    <ContactRow icon={Clock3} label="Hours">
                      {partner.hoursNote}
                    </ContactRow>
                  )}
                  {partner.website && (
                    <ContactRow icon={Globe} label="Website">
                      <a
                        className="font-medium underline underline-offset-2"
                        href={partner.website}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {partner.website.replace(/^https?:\/\//, "")}
                      </a>
                    </ContactRow>
                  )}
                </dl>
              ) : (
                // Three empty rows read as a broken screen; one line reads as a fact.
                <p className="mt-3 text-sm text-muted-foreground">
                  No contact details on file. Reach this partner through a coordinator.
                </p>
              )}
            </section>

            {isRecipient && (
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wide text-primary">Intake</h3>
                <dl className="mt-3 space-y-2.5 text-sm">
                  <div className="flex gap-3">
                    <dt className="w-20 shrink-0 text-muted-foreground">Households</dt>
                    <dd className="font-medium">{partner.householdsServed.toLocaleString()}</dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-20 shrink-0 text-muted-foreground">Capacity</dt>
                    <dd className="font-medium">{partner.capacityLbs.toLocaleString()} lb</dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-20 shrink-0 text-muted-foreground">Cold chain</dt>
                    <dd className="font-medium">
                      {partner.coldStorage ? "Refrigerated" : "Ambient only"}
                    </dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-20 shrink-0 text-muted-foreground">Accepts</dt>
                    <dd className="font-medium capitalize">
                      {partner.acceptedCategories.length
                        ? partner.acceptedCategories.join(", ")
                        : "Not specified"}
                    </dd>
                  </div>
                </dl>
              </section>
            )}
          </div>

          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-primary">Location</h3>
            {located ? (
              <div className="mt-3 space-y-2">
                <LiveMap
                  compact
                  points={[
                    {
                      id: partner.id,
                      lat: partner.latitude,
                      lng: partner.longitude,
                      label: partner.name,
                      kind: isRecipient ? "recipient" : "donor",
                    },
                  ]}
                  route={
                    viewer && hasPosition(viewer) ? { origin: viewer, destination } : undefined
                  }
                  onRouteSummary={setRouteSummary}
                />
                {viewer && hasPosition(viewer) ? (
                  <>
                    <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                      {routeSummary ? (
                        <>
                          <span className="font-medium">Driving route:</span>{" "}
                          {routeSummary.distance} · {routeSummary.duration}
                        </>
                      ) : (
                        "Finding the shortest driving route…"
                      )}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild variant="outline" size="sm">
                        <a
                          href={directionsUrl(origin, destination)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Google Maps
                        </a>
                      </Button>
                      <Button asChild variant="outline" size="sm">
                        <a
                          href={appleDirectionsUrl(origin, destination)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Apple Maps
                        </a>
                      </Button>
                    </div>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={locationStatus === "prompting"}
                    onClick={onRequestLocation}
                  >
                    <MapPin />{" "}
                    {locationStatus === "prompting"
                      ? "Finding your location…"
                      : "Use my location for shortest route"}
                  </Button>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                This partner has no mapped coordinates yet.
              </p>
            )}
          </section>
        </div>

        {coordinator && (
          <div className="flex flex-wrap gap-2 border-t pt-4">
            {partner.verificationStatus !== "verified" && (
              <Button disabled={busy} onClick={() => onVerify(partner.id, "verified")}>
                <ShieldCheck /> Verify partner
              </Button>
            )}
            {partner.verificationStatus !== "suspended" && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => onVerify(partner.id, "suspended")}
              >
                <X /> Suspend partner
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
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
  viewer,
  summarize,
}: {
  partners: Array<FoodBank & { milesAway?: number }>;
  coordinator: boolean;
  busy: boolean;
  locationShared: boolean;
  onVerify: (id: string, status: "verified" | "suspended") => void;
  onRequestLocation: () => void;
  locating: boolean;
  viewer: { latitude: number; longitude: number } | null;
  summarize: (partnerId: string) => PartnerSummary;
}) {
  const [kind, setKind] = useState<"all" | "recipient" | "donor">("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<(FoodBank & { milesAway?: number }) | null>(null);

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
              onOpen={setSelected}
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

      <PartnerDetail
        partner={selected}
        summary={selected ? summarize(selected.id) : null}
        viewer={viewer}
        locationStatus={locationShared ? "granted" : locating ? "prompting" : "idle"}
        onRequestLocation={onRequestLocation}
        coordinator={coordinator}
        busy={busy}
        onVerify={onVerify}
        onClose={() => setSelected(null)}
      />
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
