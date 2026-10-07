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

  it("still renders without a Google key, because the OpenStreetMap renderer needs none", async () => {
    vi.stubEnv("VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY", "");
    render(<LiveMap points={[{ ...BANK }]} />);

    // The legend only appears once a map is live, so finding it proves one rendered.
    expect(await screen.findByText("Riverbend Food Pantry")).toBeInTheDocument();
    expect(screen.queryByText(/not configured/i)).not.toBeInTheDocument();
  });
});

describe("LiveMap engine reporting", () => {
  it("names OpenStreetMap when no Google key is configured", async () => {
    vi.stubEnv("VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY", "");
    render(<LiveMap points={[{ ...BANK }]} />);

    expect(await screen.findByText("OpenStreetMap")).toBeInTheDocument();
  });

  it("says plainly when Google rejected the domain, instead of falling back silently", async () => {
    vi.stubEnv("VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY", "a-key");
    // Google loads but refuses this origin; the library calls gm_authFailure.
    delete (window as unknown as { google?: unknown }).google;
    render(<LiveMap points={[{ ...BANK }]} />);
    window.gm_authFailure?.();

    expect(await screen.findByText(/google rejected this domain/i)).toBeInTheDocument();
  });

  it("explains the rejection in a way that says what to change", async () => {
    vi.stubEnv("VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY", "a-key");
    delete (window as unknown as { google?: unknown }).google;
    render(<LiveMap points={[{ ...BANK }]} />);
    window.gm_authFailure?.();

    const badge = await screen.findByTitle(/website restrictions in google cloud console/i);
    expect(badge).toBeInTheDocument();
  });
});

describe("LiveMap stacking", () => {
  it("isolates its stacking context so Leaflet controls cannot cover app chrome", async () => {
    const { container } = render(<LiveMap points={[{ ...BANK }]} />);
    await screen.findByText("Riverbend Food Pantry");

    // Leaflet puts its panes at z-index 400 and its controls at 1000. Without an
    // isolated stacking context those beat the sidebar tooltip at z-50.
    expect(container.firstElementChild?.className).toContain("isolate");
  });
});
