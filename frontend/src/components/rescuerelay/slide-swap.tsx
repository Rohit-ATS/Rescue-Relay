import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Long enough to read as a movement, short enough not to delay a dispatcher. */
const LEAVE_MS = 140;
const ENTER_MS = 260;

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Slides one panel out and the next one in when the selection changes.
 *
 * The outgoing content is held in a ref for the duration of the leave, because the
 * parent has already re-rendered with the new selection by the time the change is
 * observed. Only `swapKey` drives the effect — depending on `children` would re-run it
 * on every render, since JSX children are a fresh value each time.
 */
export function SlideSwap({
  swapKey,
  className,
  children,
}: {
  /** Identifies the current panel. A change to it plays the transition. */
  swapKey: string;
  className?: string;
  children: ReactNode;
}) {
  const [visibleKey, setVisibleKey] = useState(swapKey);
  const [leaving, setLeaving] = useState(false);

  // Held at the visible panel. The parent re-renders with the new children before the
  // effect observes the change, so gating on the key is what keeps the outgoing panel
  // on screen; gating on `leaving` alone would capture the incoming one immediately.
  const held = useRef<ReactNode>(children);
  if (swapKey === visibleKey && !leaving) held.current = children;

  useEffect(() => {
    if (swapKey === visibleKey) return;
    if (prefersReducedMotion()) {
      setVisibleKey(swapKey);
      return;
    }
    setLeaving(true);
    const timer = setTimeout(() => {
      setVisibleKey(swapKey);
      setLeaving(false);
    }, LEAVE_MS);
    return () => clearTimeout(timer);
  }, [swapKey, visibleKey]);

  return (
    <div
      // Remounting on each phase restarts the animation; without it the second
      // selection in a row would slide in only once.
      key={leaving ? `${visibleKey}-leaving` : visibleKey}
      className={cn(
        leaving
          ? "animate-out fade-out slide-out-to-left-6 fill-mode-forwards"
          : "animate-in fade-in slide-in-from-right-6",
        className,
      )}
      style={{ animationDuration: `${leaving ? LEAVE_MS : ENTER_MS}ms` }}
    >
      {held.current}
    </div>
  );
}
