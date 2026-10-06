import { HeartHandshake, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The RescueRelay lockup.
 *
 * `compact` drops the wordmark, leaving just the mark — what the collapsed sidebar
 * rail needs so the brand stays present at 72px wide.
 */
export function Brand({
  inverse = false,
  compact = false,
}: {
  inverse?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 font-semibold",
        inverse ? "text-primary-foreground" : "text-foreground",
      )}
    >
      <span className="relative grid size-10 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground shadow-sm">
        <HeartHandshake className="size-5" />
        <Radio className="absolute -right-1 -top-1 size-3 rounded-full bg-signal p-0.5 text-signal-foreground" />
      </span>
      {!compact && <span className="truncate text-lg">RescueRelay</span>}
    </div>
  );
}
