/**
 * Date and time formatting for the workspace.
 *
 * Every string in this UI is English, but `toLocaleString(undefined, ...)` follows the
 * browser locale, so a Vietnamese browser rendered deadlines as "19:40 5 thg 10" —
 * mixed-language, and ambiguous about whether 5 is the day or the month. Formatting is
 * pinned to en-US so a timestamp always reads the same way as the label beside it.
 *
 * Times remain in the viewer's own zone, which is what a pickup deadline must respect.
 */
const LOCALE = "en-US";

const MOMENT = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const CLOCK = new Intl.DateTimeFormat(LOCALE, { hour: "numeric", minute: "2-digit" });

const DAY = new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric" });

function valid(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/** "Oct 5, 7:40 PM" — the default for any timestamp shown next to English copy. */
export function formatMoment(value: string): string {
  const parsed = valid(value);
  return parsed ? MOMENT.format(parsed) : "—";
}

/** "7:40 PM" — for when the day is already established by its context. */
export function formatClock(value: string): string {
  const parsed = valid(value);
  return parsed ? CLOCK.format(parsed) : "—";
}

/** "Oct 5" — for grouping headers and receipts. */
export function formatDay(value: string): string {
  const parsed = valid(value);
  return parsed ? DAY.format(parsed) : "—";
}
