import { HeartHandshake, Radio } from "lucide-react";

export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className={`flex items-center gap-3 font-semibold ${inverse ? "text-primary-foreground" : "text-foreground"}`}>
      <span className="relative grid size-10 place-items-center rounded-md bg-primary text-primary-foreground shadow-sm">
        <HeartHandshake className="size-5" />
        <Radio className="absolute -right-1 -top-1 size-3 rounded-full bg-signal p-0.5 text-signal-foreground" />
      </span>
      <span className="text-lg">RescueRelay</span>
    </div>
  );
}
