import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SlideSwap } from "@/components/rescuerelay/slide-swap";

function setReducedMotion(reduce: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => {},
    }),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  setReducedMotion(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SlideSwap", () => {
  it("keeps the outgoing panel on screen while it slides away", () => {
    const { rerender } = render(
      <SlideSwap swapKey="a">
        <p>Rescue A</p>
      </SlideSwap>,
    );
    expect(screen.getByText("Rescue A")).toBeInTheDocument();

    rerender(
      <SlideSwap swapKey="b">
        <p>Rescue B</p>
      </SlideSwap>,
    );

    // The parent already holds the new selection, but the old panel is still leaving.
    expect(screen.getByText("Rescue A")).toBeInTheDocument();
    expect(screen.queryByText("Rescue B")).not.toBeInTheDocument();
  });

  it("shows the incoming panel once the leave finishes", () => {
    const { rerender } = render(
      <SlideSwap swapKey="a">
        <p>Rescue A</p>
      </SlideSwap>,
    );
    rerender(
      <SlideSwap swapKey="b">
        <p>Rescue B</p>
      </SlideSwap>,
    );

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText("Rescue B")).toBeInTheDocument();
    expect(screen.queryByText("Rescue A")).not.toBeInTheDocument();
  });

  it("applies the leave animation, then the enter animation", () => {
    const { container, rerender } = render(
      <SlideSwap swapKey="a">
        <p>Rescue A</p>
      </SlideSwap>,
    );
    rerender(
      <SlideSwap swapKey="b">
        <p>Rescue B</p>
      </SlideSwap>,
    );

    expect(container.firstElementChild?.className).toContain("slide-out-to-left-6");

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(container.firstElementChild?.className).toContain("slide-in-from-right-6");
  });

  it("refreshes content for the same panel without animating", () => {
    const { container, rerender } = render(
      <SlideSwap swapKey="a">
        <p>150 lb</p>
      </SlideSwap>,
    );
    rerender(
      <SlideSwap swapKey="a">
        <p>160 lb</p>
      </SlideSwap>,
    );

    expect(screen.getByText("160 lb")).toBeInTheDocument();
    expect(container.firstElementChild?.className).not.toContain("slide-out-to-left-6");
  });

  it("swaps instantly when the viewer prefers reduced motion", () => {
    setReducedMotion(true);
    const { rerender } = render(
      <SlideSwap swapKey="a">
        <p>Rescue A</p>
      </SlideSwap>,
    );
    rerender(
      <SlideSwap swapKey="b">
        <p>Rescue B</p>
      </SlideSwap>,
    );

    expect(screen.getByText("Rescue B")).toBeInTheDocument();
  });
});
