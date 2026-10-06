import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveMap, type MapPoint } from "@/components/rescuerelay/live-map";

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
  vi.stubEnv("VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY", "test-key");
  installFakeMapsApi();
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete (window as unknown as { google?: unknown }).google;
});

describe("LiveMap", () => {
  it("builds the map exactly once on mount", async () => {
    render(<LiveMap points={[{ ...PICKUP }]} />);

    await waitFor(() => expect(mapConstructions).toBe(1));
    // Give any render loop several frames to show itself.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(mapConstructions).toBe(1);
    expect(markerConstructions).toBe(1);
  });

  it("does not rebuild when a re-render passes the same locations in a new array", async () => {
    // The real failure: an inline literal changes identity every render, and the
    // effect calls setReady(false) as it starts. Keying on identity therefore looped
    // render -> effect -> setState -> render, rebuilding the map until it never painted.
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

  it("explains itself when no location is configured", async () => {
    vi.stubEnv("VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY", "");
    render(<LiveMap points={[{ ...PICKUP }]} />);

    expect(await screen.findByText(/live map connection is not configured/i)).toBeInTheDocument();
  });
});
