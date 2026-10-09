import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LiveMap,
  RouteDirections,
  getGoogleMapsDirectionsUrl,
  resetGoogleMapsStateForTesting,
  summarizeDirections,
  type MapPoint,
} from "@/components/rescuerelay/live-map";

/** Counts constructions so a rebuild loop is visible rather than merely slow. */
let mapConstructions = 0;
let markerConstructions = 0;
let polylineConstructions = 0;
let markerClicks: Array<() => void> = [];
let lastPopup: string | HTMLElement | null = null;

function installFakeMapsApi(routeImpl?: () => Promise<unknown>) {
  mapConstructions = 0;
  markerConstructions = 0;
  polylineConstructions = 0;
  markerClicks = [];
  lastPopup = null;
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
        addListener(event: string, handler: () => void) {
          markerClicks.push(handler);
        }
      },
      LatLngBounds: class {
        extend() {}
      },
      InfoWindow: class {
        setContent(content: string | HTMLElement) {
          lastPopup = content;
        }
        open() {}
        close() {}
      },
      Size: class {},
      Point: class {},
      DirectionsService: class {
        route() {
          return routeImpl ? routeImpl() : Promise.resolve({ routes: [] });
        }
      },
      DirectionsRenderer: class {
        setMap() {}
        setDirections() {}
        setRouteIndex() {}
      },
      Polyline: class {
        constructor() {
          polylineConstructions += 1;
        }
        setMap() {}
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
  localStorage.removeItem("rr_google_maps_key");
  vi.stubEnv("VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY", "test-key");
  installFakeMapsApi();
});

afterEach(() => {
  resetGoogleMapsStateForTesting();
  localStorage.removeItem("rr_google_maps_key");
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

  // Each count carries its own swatch, so the two are separate elements rather
  // than one run of text.
  it("counts both kinds when several locations are shown", async () => {
    render(<LiveMap points={[{ ...PICKUP }, { ...BANK }]} />);

    expect(await screen.findByText("1 pickup")).toBeInTheDocument();
    expect(screen.getByText("1 food bank")).toBeInTheDocument();
  });

  it("asks for a Google Maps key when none is configured", async () => {
    vi.stubEnv("VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY", "");
    render(<LiveMap points={[{ ...PICKUP }, { ...BANK }]} />);

    expect(await screen.findByText(/Google Maps browser API key is required/)).toBeInTheDocument();
  });

  it("does not render a non-Google map when no Google key is configured", async () => {
    vi.stubEnv("VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY", "");
    const { container } = render(<LiveMap points={[{ ...BANK }]} />);

    expect(await screen.findByText(/Google Maps browser API key is required/)).toBeInTheDocument();
    expect(container.querySelector("iframe")).not.toBeInTheDocument();
  });

  it("keeps a user-provided browser key after the map is refreshed", async () => {
    const user = userEvent.setup();
    vi.stubEnv("VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY", "");
    render(<LiveMap points={[{ ...PICKUP }]} />);

    await user.click(await screen.findByRole("button", { name: /set api key/i }));
    await user.type(
      screen.getByRole("textbox", { name: "Google Maps API Key" }),
      "AIzaSavedBrowserKey",
    );
    await user.click(screen.getByRole("button", { name: /save key/i }));

    await waitFor(() => {
      expect(localStorage.getItem("rr_google_maps_key")).toBe("AIzaSavedBrowserKey");
    });
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

  it("reports a Google Maps key rejection without rendering a fallback map", async () => {
    vi.stubEnv("VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY", "a-key");
    delete (window as unknown as { google?: unknown }).google;
    const { container } = render(<LiveMap points={[{ ...BANK }]} />);
    act(() => {
      window.gm_authFailure?.();
    });

    expect(await screen.findByText(/Google Maps rejected the browser API key/)).toBeInTheDocument();
    expect(container.querySelector("iframe")).not.toBeInTheDocument();
  });
});

describe("LiveMap stacking", () => {
  it("isolates its stacking context so map overlays cannot cover app chrome", async () => {
    const { container } = render(<LiveMap points={[{ ...BANK }]} />);
    await screen.findByText("Riverbend Food Pantry");

    expect(container.firstElementChild?.className).toContain("isolate");
  });
});

/** Two legs, as Google returns for driver → pickup → food bank. */
const TWO_LEG_RESULT = {
  routes: [
    {
      legs: [
        {
          distance: { text: "3.0 mi", value: 4828 },
          duration: { text: "8 mins", value: 480 },
          steps: [
            { instructions: "Head <b>north</b> on <b>2nd Ave</b>", distance: { value: 1600 } },
            {
              instructions: "Turn <b>left</b>&nbsp;onto <b>Hickman Rd</b>",
              distance: { value: 3228 },
            },
          ],
        },
        {
          distance: { text: "5.0 mi", value: 8047 },
          duration: { text: "12 mins", value: 720 },
          steps: [
            { instructions: "Turn <b>right</b> onto <b>E 17th St</b>", distance: { value: 8047 } },
          ],
        },
      ],
    },
  ],
};

describe("Directions summary", () => {
  // The old read took legs[0] only, so a run through a pickup was reported as the
  // distance to the pickup — understating what a volunteer was signing up for.
  it("totals every leg, not just the first", () => {
    const read = summarizeDirections(TWO_LEG_RESULT);

    expect(read?.summary.distance).toBe("8.0 mi");
    expect(read?.summary.duration).toBe("20 min");
    expect(read?.summary.followsRoads).toBe(true);
  });

  it("carries every leg's manoeuvres as plain text", () => {
    const read = summarizeDirections(TWO_LEG_RESULT);

    expect(read?.summary.steps.map((s) => s.instruction)).toEqual([
      "Head north on 2nd Ave",
      "Turn left onto Hickman Rd",
      "Turn right onto E 17th St",
    ]);
  });

  it("picks the alternative that is shortest over the whole trip", () => {
    const read = summarizeDirections({
      routes: [
        {
          legs: [
            { distance: { text: "1 mi", value: 1000 }, duration: { text: "2", value: 120 } },
            { distance: { text: "20 mi", value: 32000 }, duration: { text: "30", value: 1800 } },
          ],
        },
        {
          legs: [
            { distance: { text: "5 mi", value: 8000 }, duration: { text: "9", value: 540 } },
            { distance: { text: "5 mi", value: 8000 }, duration: { text: "9", value: 540 } },
          ],
        },
      ],
    });

    expect(read?.routeIndex).toBe(1);
  });

  it("reports nothing when Google returned no usable route", () => {
    expect(summarizeDirections({ routes: [] })).toBeNull();
    expect(summarizeDirections({ routes: [{ legs: [] }] })).toBeNull();
  });
});

describe("Route hand-off to Google Maps", () => {
  it("keeps the pickup as a waypoint so the driver is not sent straight to the drop-off", () => {
    const url = getGoogleMapsDirectionsUrl([], {
      origin: { lat: 41.6, lng: -93.6 },
      destination: { lat: 41.61, lng: -93.59 },
      waypoints: [{ lat: 41.58, lng: -93.63 }],
    });

    expect(url).toContain("waypoints=41.58%2C-93.63");
    expect(url).toContain("origin=41.6%2C-93.6");
    expect(url).toContain("destination=41.61%2C-93.59");
  });
});

describe("LiveMap route drawing", () => {
  const ROUTE = {
    origin: { lat: PICKUP.lat, lng: PICKUP.lng },
    destination: { lat: BANK.lat, lng: BANK.lng },
  };

  it("reports the summed route when Google answers", async () => {
    installFakeMapsApi(() => Promise.resolve(TWO_LEG_RESULT));
    const onRouteSummary = vi.fn();
    render(<LiveMap points={[PICKUP, BANK]} route={ROUTE} onRouteSummary={onRouteSummary} />);

    await waitFor(() => expect(onRouteSummary).toHaveBeenCalled());
    expect(onRouteSummary.mock.calls.at(-1)?.[0]).toMatchObject({
      distance: "8.0 mi",
      followsRoads: true,
    });
    expect(polylineConstructions).toBe(0);
  });

  // A browser key with Maps JS but not the Directions API left the panel waiting for
  // a route that was never coming.
  it("falls back to the keyless road route when the Directions API refuses", async () => {
    installFakeMapsApi(() => Promise.reject(new Error("REQUEST_DENIED")));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [
          {
            distance: 12875,
            duration: 1200,
            geometry: {
              coordinates: [
                [PICKUP.lng, PICKUP.lat],
                [BANK.lng, BANK.lat],
              ],
            },
            legs: [
              { steps: [{ distance: 1600, name: "2nd Avenue", maneuver: { type: "depart" } }] },
            ],
          },
        ],
      }),
    } as unknown as Response);
    const onRouteSummary = vi.fn();

    render(<LiveMap points={[PICKUP, BANK]} route={ROUTE} onRouteSummary={onRouteSummary} />);

    await waitFor(() => expect(onRouteSummary).toHaveBeenCalled());
    const summary = onRouteSummary.mock.calls.at(-1)?.[0];
    expect(summary).toMatchObject({ distance: "8.0 mi", followsRoads: true });
    expect(summary.steps[0].instruction).toBe("Start the drive on 2nd Avenue");
    // The route is drawn by hand, since DirectionsRenderer has nothing to render.
    expect(polylineConstructions).toBe(1);
    fetchSpy.mockRestore();
  });
});

describe("RouteDirections", () => {
  it("lists the manoeuvres a driver has to follow", async () => {
    render(
      <RouteDirections
        summary={{
          distance: "8.0 mi",
          duration: "20 min",
          followsRoads: true,
          steps: [
            { instruction: "Head north on 2nd Ave", distanceMiles: 1 },
            { instruction: "Turn left onto Hickman Rd", distanceMiles: 2 },
          ],
        }}
      />,
    );

    expect(screen.getByText("Head north on 2nd Ave")).toBeInTheDocument();
    expect(screen.getByText("Turn left onto Hickman Rd")).toBeInTheDocument();
    expect(screen.getByText(/2 steps/)).toBeInTheDocument();
  });

  it("says so plainly when only a straight-line estimate was possible", () => {
    render(
      <RouteDirections
        summary={{ distance: "8 mi", duration: "20 min", followsRoads: false, steps: [] }}
      />,
    );

    expect(screen.getByText(/Straight-line estimate only/)).toBeInTheDocument();
  });

  it("renders nothing before a route has been drawn", () => {
    const { container } = render(<RouteDirections summary={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Marker popups", () => {
  /** Opens the first marker's popup and hands back its element. */
  async function openFirstPopup(point: MapPoint) {
    render(<LiveMap points={[point]} />);
    await waitFor(() => expect(markerClicks.length).toBe(1));
    markerClicks[0]?.();
    return lastPopup as HTMLElement;
  }

  it("shows the partner's photo above its name", async () => {
    const popup = await openFirstPopup({
      ...BANK,
      photoUrl: "https://foodbankiowa.org/hero.jpg",
    });

    const image = popup.querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://foodbankiowa.org/hero.jpg");
    expect(image?.getAttribute("alt")).toBe("Riverbend Food Pantry");
  });

  // Every popup carries a picture, so one without a photo gets the drawn stand-in
  // rather than a gap where the others have an image.
  it("draws a stand-in for a location with no photo", async () => {
    const popup = await openFirstPopup({ ...BANK });

    const image = popup.querySelector("img");
    expect(image?.getAttribute("src")).toContain("data:image/svg+xml");
    expect(image?.getAttribute("aria-hidden")).toBe("true");
  });

  it("swaps a photo that fails to load for the stand-in", async () => {
    const popup = await openFirstPopup({ ...BANK, photoUrl: "https://example.org/gone.jpg" });

    const image = popup.querySelector("img") as HTMLImageElement;
    image.dispatchEvent(new Event("error"));

    expect(image.getAttribute("src")).toContain("data:image/svg+xml");
    expect(popup.querySelectorAll("img")).toHaveLength(1);
  });

  // The URL comes from a partner record a coordinator can edit.
  it("refuses a photo URL that is not http(s)", async () => {
    const popup = await openFirstPopup({
      ...BANK,
      photoUrl: "javascript:alert(1)",
    });

    const image = popup.querySelector("img");
    expect(image?.getAttribute("src")).toContain("data:image/svg+xml");
  });
});
