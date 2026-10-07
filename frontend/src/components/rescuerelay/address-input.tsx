import { useEffect, useId, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";

import { suggestAddresses, type AddressSuggestion } from "@/lib/address-suggest";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Long enough that a fast typist issues one request, not one per keystroke. */
const DEBOUNCE_MS = 350;

/**
 * Pickup address field with type-ahead suggestions.
 *
 * Suggestions are a convenience, never a requirement: the field is an ordinary text
 * input, so a donor can type an address the provider has never heard of and the server
 * will still geocode it.
 */
export function AddressInput({
  id,
  name,
  value,
  onValueChange,
  placeholder,
  ...rest
}: {
  id: string;
  name: string;
  value: string;
  onValueChange: (next: string) => void;
  placeholder?: string;
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "id" | "name">) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  // Set when a suggestion is taken, so the resulting value change does not re-query.
  const justChose = useRef(false);

  useEffect(() => {
    if (justChose.current) {
      justChose.current = false;
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      const results = await suggestAddresses(value, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setSuggestions(results);
      setActive(-1);
      setOpen(results.length > 0);
      setLoading(false);
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
      setLoading(false);
    };
  }, [value]);

  function choose(suggestion: AddressSuggestion) {
    justChose.current = true;
    onValueChange(suggestion.value);
    setOpen(false);
    setSuggestions([]);
    setActive(-1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || !suggestions.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === "Enter" && active >= 0) {
      // Only intercept Enter while a suggestion is highlighted, so the form can
      // still be submitted from this field when it is not.
      event.preventDefault();
      const picked = suggestions[active];
      if (picked) choose(picked);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <Input
        {...rest}
        id={id}
        name={name}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        {...(active >= 0 ? { "aria-activedescendant": `${listId}-${active}` } : {})}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        // Delayed so a click on a suggestion lands before the list unmounts.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={cn("pr-9", rest.className)}
      />
      {loading && (
        <Loader2
          aria-hidden="true"
          className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
        />
      )}

      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Address suggestions"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {suggestions.map((suggestion, index) => (
            <li key={suggestion.value}>
              <button
                type="button"
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(suggestion)}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  "flex w-full items-start gap-2 rounded px-2 py-2 text-left text-sm",
                  index === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                )}
              >
                <MapPin
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{suggestion.primary}</span>
                  {suggestion.secondary && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {suggestion.secondary}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
