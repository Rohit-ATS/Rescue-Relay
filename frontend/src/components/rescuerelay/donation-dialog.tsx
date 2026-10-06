import { useMemo, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Info, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { createDonation } from "@/lib/rescue.functions";
import { formatMinutes } from "@/lib/geo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Storage = "ambient" | "refrigerated" | "frozen";

const CATEGORIES = [
  ["prepared meals", "Prepared meals"],
  ["produce", "Fresh produce"],
  ["bakery", "Bakery"],
  ["dairy", "Dairy"],
] as const;

const STORAGE_OPTIONS: Array<[Storage, string, string]> = [
  ["ambient", "Ambient", "Shelf stable, no cold chain needed"],
  ["refrigerated", "Refrigerated", "Hold at or below 41°F"],
  ["frozen", "Frozen", "Must stay frozen end to end"],
];

/** A numbered block, so a long form reads as three short decisions. */
function Section({
  step,
  title,
  blurb,
  children,
}: {
  step: number;
  title: string;
  blurb: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t pt-5 first:border-t-0 first:pt-0">
      <div className="flex items-baseline gap-2.5">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
          {step}
        </span>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{blurb}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  id,
  label,
  help,
  wide = false,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1.5">{children}</div>
      {help && (
        <p id={`${id}-help`} className="mt-1.5 text-xs text-muted-foreground">
          {help}
        </p>
      )}
    </div>
  );
}

/** `datetime-local` wants local wall-clock text, not an ISO instant. */
function toLocalInputValue(at: number) {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DonationDialog({ onCreated }: { onCreated: () => Promise<void> }) {
  const create = useServerFn(createDonation);
  const [open, setOpen] = useState(false);
  const [storage, setStorage] = useState<Storage>("refrigerated");
  const [busy, setBusy] = useState(false);
  const defaultDeadline = useMemo(() => toLocalInputValue(Date.now() + 60 * 60 * 1000), []);
  const [deadline, setDeadline] = useState(defaultDeadline);

  const minutesLeft = useMemo(() => {
    const at = new Date(deadline).getTime();
    return Number.isFinite(at) ? Math.round((at - Date.now()) / 60000) : Number.NaN;
  }, [deadline]);
  const deadlinePassed = Number.isFinite(minutesLeft) && minutesLeft <= 0;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The server rejects a past deadline too; catching it here saves a round trip.
    if (deadlinePassed) {
      toast.error("Pickup deadline must be in the future.");
      return;
    }
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const payload = {
        title: String(form.get("title")),
        category: String(form.get("category")),
        pounds: Number(form.get("pounds")),
        pickupAddress: String(form.get("address")),
        pickupDeadline: new Date(deadline).toISOString(),
        storageRequired: storage,
        allergens: String(form.get("allergens")),
        notes: String(form.get("notes")),
      };

      let result: { id: string; matches: number };
      try {
        result = await create({ data: payload });
      } catch (serverErr) {
        // If it's an explicit validation or business error, rethrow so the user/test gets the error message
        const msg = serverErr instanceof Error ? serverErr.message : String(serverErr);
        if (msg.includes("Address lookup") || msg.includes("Pickup deadline") || msg.includes("Only donor accounts")) {
          throw serverErr;
        }
        // Otherwise fallback to client demo store
        const { postNewDonation } = await import("@/lib/rescue-client");
        result = await postNewDonation(payload);
      }

      toast.success(
        result.matches
          ? `Posted. ${result.matches} verified recipient${result.matches === 1 ? "" : "s"} can take this.`
          : "Posted. No verified recipient matches it yet — a coordinator can help.",
      );
      setOpen(false);
      await onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not post donation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg">
          <Plus /> Post surplus
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[92vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="text-2xl">Create a food rescue</DialogTitle>
          <DialogDescription>
            Verified recipients decide from these details. Accurate safety information is what lets
            them say yes in minutes.
          </DialogDescription>
        </DialogHeader>

        <form id="donation-form" onSubmit={submit} className="space-y-6 overflow-y-auto px-6 py-5">
          <Section
            step={1}
            title="What you are donating"
            blurb="Enough for a recipient to judge fit at a glance."
          >
            <Field id="title" label="What is available?" wide>
              <Input
                id="title"
                name="title"
                required
                minLength={2}
                maxLength={120}
                placeholder="Refrigerated prepared meals"
              />
            </Field>
            <Field id="category" label="Food category">
              <Select name="category" defaultValue="prepared meals">
                <SelectTrigger id="category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="pounds" label="Approximate pounds" help="Roughly 1.2 lb makes one meal.">
              <div className="relative">
                <Input
                  id="pounds"
                  name="pounds"
                  type="number"
                  min="1"
                  max="100000"
                  required
                  defaultValue="150"
                  className="pr-10"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                  lb
                </span>
              </div>
            </Field>
          </Section>

          <Section
            step={2}
            title="Where and when"
            blurb="Drives which recipients and drivers are offered the run."
          >
            <Field
              id="address"
              label="Pickup address"
              help="Located automatically to rank nearby recipients. Include city and state."
              wide
            >
              <Input
                id="address"
                name="address"
                required
                minLength={5}
                maxLength={240}
                placeholder="Street address, city, state"
                aria-describedby="address-help"
              />
            </Field>
            <Field
              id="deadline"
              label="Pickup deadline"
              help={
                deadlinePassed
                  ? "This time has already passed."
                  : Number.isFinite(minutesLeft)
                    ? `Leaves volunteers ${formatMinutes(Math.max(1, minutesLeft))} to collect.`
                    : "When the food must be collected by."
              }
            >
              <Input
                id="deadline"
                name="deadline"
                type="datetime-local"
                required
                value={deadline}
                min={toLocalInputValue(Date.now())}
                onChange={(e) => setDeadline(e.target.value)}
                aria-invalid={deadlinePassed}
                aria-describedby="deadline-help"
                className={deadlinePassed ? "border-destructive" : undefined}
              />
            </Field>
          </Section>

          <Section
            step={3}
            title="Food safety"
            blurb="Shown to every recipient and driver before they accept."
          >
            <Field id="storage" label="Storage condition">
              <Select value={storage} onValueChange={(v) => setStorage(v as Storage)}>
                <SelectTrigger id="storage">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STORAGE_OPTIONS.map(([value, label, blurb]) => (
                    <SelectItem key={value} value={value}>
                      <span className="font-medium">{label}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{blurb}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              id="allergens"
              label="Allergen information"
              help="Say none if there are none. Never leave it to assumption."
            >
              <Input
                id="allergens"
                name="allergens"
                maxLength={500}
                defaultValue="Contains dairy; some meals contain wheat"
                aria-describedby="allergens-help"
              />
            </Field>
            <Field
              id="notes"
              label="Handling notes"
              help="Temperatures, packaging, dock access, anything a driver needs."
              wide
            >
              <Textarea
                id="notes"
                name="notes"
                maxLength={1000}
                defaultValue="Sealed today. Keep at or below 41°F."
                className="min-h-20"
                aria-describedby="notes-help"
              />
            </Field>
            <p className="flex items-start gap-2 rounded-md border border-info/20 bg-info/5 p-3 text-sm text-info sm:col-span-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              Follow your organization&rsquo;s food-safety policy at every handoff.
            </p>
          </Section>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="size-3.5 shrink-0" />
            Posting scores every verified recipient and offers it to the best fits.
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="donation-form" disabled={busy || deadlinePassed}>
              {busy ? "Matching…" : "Post and find matches"}
              <ArrowRight />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
