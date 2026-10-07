import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LiveMap,
  resetGoogleMapsStateForTesting,
  type MapPoint,
} from "@/components/rescuerelay/live-map";

/** Counts constructions so a rebuild loop is visible rather than merely slow. */
let mapConstructions = 0;
let markerConstructions = 0;

function installFakeMapsApi() {
  mapConstructions = 0;
  markerConstructions = 0;
  (window as unknown as { google: unknown }).google = {
    maps: {
      Map: class {
        constructor() {
          mapConstructions += 1;
        }
        fitBounds() {}
      },
      Marker: class {
        constructor() {
          markerConstructions += 1;
        }
        setMap() {}
        addListener() {}
      },
      LatLngBounds: class {
        extend() {}
      },
      InfoWindow: class {
        setContent() {}
        open() {}
        close() {}
      },
      Size: class {},
      Point: class {},
      DirectionsService: class {
        route() {
          return Promise.resolve({ routes: [] });
        }
      },
      DirectionsRenderer: class {
        setMap() {}
        setDirections() {}
      },
      TravelMode: { DRIVING: "DRIVING" },
    },
  };
}

const PICKUP: MapPoint = {
  id: "a",
  lat: 41.5908,
  lng: -93.6208,
  label: "400 E Locust St",
  kind: "donor",
};
const BANK: MapPoint = {
  id: "b",
  lat: 41.6143,
  lng: -93.5911,
  label: "Riverbend Food Pantry",
  kind: "recipient",
};

beforeEach(() => {
  resetGoogleMapsStateForTesting();
  vi.stubEnv("VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY", "test-key");
  installFakeMapsApi();
});

afterEach(() => {
  resetGoogleMapsStateForTesting();
  vi.unstubAllEnvs();
  delete (window as unknown as { google?: unknown }).google;
});

describe("LiveMap", () => {
  it("builds the map exactly once on mount", async () => {
    render(<LiveMap points={[{ ...PICKUP }]} />);

    await waitFor(() => expect(mapConstructions).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(mapConstructions).toBe(1);
    expect(markerConstructions).toBe(1);
  });

  it("does not rebuild when a re-render passes the same locations in a new array", async () => {
    const { rerender } = render(<LiveMap points={[{ ...PICKUP }]} />);
    await waitFor(() => expect(mapConstructions).toBe(1));

    rerender(<LiveMap points={[{ ...PICKUP }]} />);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mapConstructions).toBe(1);
  });

  it("rebuilds when the locations actually change", async () => {
    const { rerender } = render(<LiveMap points={[{ ...PICKUP }]} />);
    await waitFor(() => expect(mapConstructions).toBe(1));

    rerender(<LiveMap points={[{ ...PICKUP }, { ...BANK }]} />);

    await waitFor(() => expect(mapConstructions).toBe(2));
    expect(markerConstructions).toBe(3);
  });

  it("names the place on a single-location map instead of tallying two kinds", async () => {
    render(<LiveMap points={[{ ...BANK }]} />);

    expect(await screen.findByText("Riverbend Food Pantry")).toBeInTheDocument();
    expect(screen.queryByText(/0 food banks/)).not.toBeInTheDocument();
  });

  it("counts both kinds when several locations are shown", async () => {
    render(<LiveMap points={[{ ...PICKUP }, { ...BANK }]} />);

    expect(await screen.findByText(/1 pickup · 1 food bank/)).toBeInTheDocument();
  });

  it("renders Google Maps Embed when no Google key is configured", async () => {
    vi.stubEnv("VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY", "");
    const { container } = render(<LiveMap points={[{ ...BANK }]} />);

    const iframe = await waitFor(() => container.querySelector("iframe"));
    expect(iframe).toBeInTheDocument();
    expect(iframe?.getAttribute("src")).toContain("maps.google.com");
    expect(await screen.findByText("Riverbend Food Pantry")).toBeInTheDocument();
  });
});

describe("LiveMap engine reporting", () => {
  it("always provides a direct Google Maps action link", async () => {
    vi.stubEnv("VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY", "");
    render(<LiveMap points={[{ ...BANK }]} />);

    const link = await screen.findByRole("link", { name: /Google Maps/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toContain("google.com/maps");
  });

  it("renders Google Maps Embed when Google JS declines, without flagging an error", async () => {
    vi.stubEnv("VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY", "a-key");
    delete (window as unknown as { google?: unknown }).google;
    const { container } = render(<LiveMap points={[{ ...BANK }]} />);
    act(() => {
      window.gm_authFailure?.();
    });

    const iframe = await waitFor(() => container.querySelector("iframe"));
    expect(iframe).toBeInTheDocument();
    expect(iframe?.getAttribute("src")).toContain("maps.google.com");
    expect(await screen.findByText("Riverbend Food Pantry")).toBeInTheDocument();
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
  });
});

describe("LiveMap stacking", () => {
  it("isolates its stacking context so map overlays cannot cover app chrome", async () => {
    const { container } = render(<LiveMap points={[{ ...BANK }]} />);
    await screen.findByText("Riverbend Food Pantry");

    expect(container.firstElementChild?.className).toContain("isolate");
  });
});
