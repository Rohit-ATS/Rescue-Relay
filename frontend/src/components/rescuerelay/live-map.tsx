import { useEffect, useRef, useState } from "react";
import { MapPin, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type MapInstance = { fitBounds: (bounds: unknown, padding?: number) => void };
type DirectionsLeg = { distance?: { text: string }; duration?: { text: string } };
type DirectionsResult = { routes?: Array<{ legs?: DirectionsLeg[] }> };
declare global {
  interface Window {
    initRescueRelayMap?: () => void;
    gm_authFailure?: () => void;
    google?: {
      maps: {
        Map: new (element: HTMLElement, options: Record<string, unknown>) => MapInstance;
        Marker: new (options: Record<string, unknown>) => {
          setMap: (map: unknown) => void;
          addListener: (event: string, handler: () => void) => void;
        };
        InfoWindow: new (options?: Record<string, unknown>) => {
          setContent: (content: string) => void;
          open: (options: Record<string, unknown>) => void;
          close: () => void;
        };
        Size: new (width: number, height: number) => unknown;
        Point: new (x: number, y: number) => unknown;
        LatLngBounds: new () => { extend: (point: { lat: number; lng: number }) => void };
        DirectionsService: new () => {
          route: (request: Record<string, unknown>) => Promise<DirectionsResult>;
        };
        DirectionsRenderer: new (options: Record<string, unknown>) => {
          setMap: (map: unknown) => void;
          setDirections: (result: DirectionsResult) => void;
        };
        TravelMode: { DRIVING: string };
      };
    };
  }
}
export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  kind: "donor" | "recipient";
};

/** Brand tokens, resolved to hex because the Maps API cannot read CSS custom properties. */
const MARKER_COLORS = {
  // Surplus waiting to move reads as urgent; its destination reads as safe arrival.
  donor: { fill: "#f2612b", ring: "#ffffff" },
  recipient: { fill: "#004c25", ring: "#ffffff" },
} as const;

const MARKER_SIZE = 40;

/**
 * A quiet basemap. Points of interest, transit and most labels are noise on a
 * dispatch map; muting them leaves the pins and the route as the only saturated
 * things on screen.
 */
const BASEMAP_STYLE = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#f4f4ef" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#d9e4e6" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ visibility: "off" }] },
  { featureType: "road.highway", elementType: "geometry.fill", stylers: [{ color: "#e6e3d8" }] },
  { featureType: "road.arterial", elementType: "geometry.fill", stylers: [{ color: "#efece2" }] },
  { featureType: "road.local", elementType: "geometry.fill", stylers: [{ color: "#f7f5ee" }] },
  {
    featureType: "administrative",
    elementType: "labels.text.fill",
    stylers: [{ color: "#6b6f66" }],
  },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#8a8d84" }] },
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
];

/**
 * A teardrop pin carrying a glyph, drawn as an inline SVG data URI.
 *
 * Donors get a box (surplus awaiting collection), recipients a house (where it lands),
 * so the two are distinguishable without reading a letter or relying on colour alone.
 */
function markerIcon(kind: MapPoint["kind"]) {
  const { fill, ring } = MARKER_COLORS[kind];
  const glyph =
    kind === "donor"
      ? '<path d="M9.2 11.4h9.6v7.4H9.2z" fill="none" stroke="' +
        ring +
        '" stroke-width="1.7" stroke-linejoin="round"/><path d="M9.2 14.1h9.6" stroke="' +
        ring +
        '" stroke-width="1.7"/>'
      : '<path d="M8.8 15.1 14 10.6l5.2 4.5v4.3H8.8z" fill="none" stroke="' +
        ring +
        '" stroke-width="1.6" stroke-linejoin="round"/>';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">' +
    '<path d="M14 39.2C14 39.2 26.4 23.6 26.4 14.4 26.4 7.5 20.9 1.9 14 1.9S1.6 7.5 1.6 14.4C1.6 23.6 14 39.2 14 39.2Z" ' +
    'fill="' +
    fill +
    '" stroke="' +
    ring +
    '" stroke-width="2.2" stroke-linejoin="round"/>' +
    glyph +
    "</svg>";
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new (window.google as NonNullable<Window["google"]>).maps.Size(28, MARKER_SIZE),
    // Anchor at the pin's tip so it points at the exact coordinate.
    anchor: new (window.google as NonNullable<Window["google"]>).maps.Point(14, MARKER_SIZE),
  };
}

/** Escapes text before it goes into an InfoWindow's HTML. */
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
/** Pickup to drop-off, drawn as a real driving route when the Maps key authorizes. */
export type MapRoute = {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
};
let mapLoader: Promise<void> | undefined;
function loadMaps(key: string, channel: string) {
  if (window.google?.maps.Map) return Promise.resolve();
  if (mapLoader) return mapLoader;
  mapLoader = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Map loading timed out.")), 20000);
    window.initRescueRelayMap = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    window.gm_authFailure = () => window.dispatchEvent(new Event("rescue-map-auth-error"));
    const script = document.createElement("script");
    script.id = "rescuerelay-google-maps";
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&callback=initRescueRelayMap&channel=${encodeURIComponent(channel)}`;
    script.onerror = () => {
      window.clearTimeout(timeout);
      mapLoader = undefined;
      script.remove();
      reject(new Error("Google Maps could not connect."));
    };
    document.head.appendChild(script);
  });
  return mapLoader;
}
export function LiveMap({
  compact = false,
  points = [],
  route,
  onRouteSummary,
}: {
  compact?: boolean;
  points?: MapPoint[];
  route?: MapRoute | undefined;
  onRouteSummary?: ((summary: { distance: string; duration: string } | null) => void) | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const pickupCount = points.filter((p) => p.kind === "donor").length;
  const dropoffCount = points.length - pickupCount;
  const key = import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY"];
  const channel = import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID"];
  useEffect(() => {
    let active = true;
    const markers: Array<{ setMap: (map: unknown) => void }> = [];
    const renderers: Array<{ setMap: (map: unknown) => void }> = [];
    const infoWindows: Array<{ close: () => void }> = [];
    const authError = () => {
      if (active) {
        setReady(false);
        setError(
          "Google Maps did not authorize this address. The managed map is available on the RescueRelay Lovable preview and published website.",
        );
      }
    };
    window.addEventListener("rescue-map-auth-error", authError);
    setError("");
    setReady(false);
    if (!key) {
      setError("Live map connection is not configured.");
      return () => window.removeEventListener("rescue-map-auth-error", authError);
    }
    void loadMaps(key, channel ?? "rescuerelay")
      .then(() => {
        const maps = window.google?.maps;
        if (!active || !maps || !ref.current) return;
        const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
        const map = new maps.Map(ref.current, {
          center: valid[0] ?? { lat: 41.5908, lng: -93.6208 },
          zoom: 12,
          clickableIcons: false,
          disableDefaultUI: true,
          zoomControl: true,
          styles: BASEMAP_STYLE,
        });
        const bounds = new maps.LatLngBounds();
        const info = new maps.InfoWindow({ disableAutoPan: false });
        infoWindows.push(info);
        valid.forEach((p) => {
          bounds.extend(p);
          const marker = new maps.Marker({
            position: { lat: p.lat, lng: p.lng },
            map,
            title: p.label,
            icon: markerIcon(p.kind),
            // Pickups sit above drop-offs so an overlapping pair stays readable.
            zIndex: p.kind === "donor" ? 2 : 1,
          });
          marker.addListener("click", () => {
            info.setContent(
              `<div style="font:500 13px/1.45 system-ui,sans-serif;color:#0a1b11;max-width:220px">` +
                `<div style="font-weight:700;margin-bottom:2px">${escapeHtml(p.label)}</div>` +
                `<div style="color:${MARKER_COLORS[p.kind].fill};font-size:11px;letter-spacing:.04em;text-transform:uppercase">` +
                `${p.kind === "donor" ? "Pickup" : "Food bank"}</div>` +
                `</div>`,
            );
            info.open({ map, anchor: marker });
          });
          markers.push(marker);
        });
        if (valid.length > 1) map.fitBounds(bounds, 45);
        setReady(true);
        if (route) {
          // Directions are a best-effort overlay: the markers and the external
          // navigation link already stand on their own if routing is unavailable.
          const renderer = new maps.DirectionsRenderer({
            map,
            suppressMarkers: true,
            preserveViewport: false,
            polylineOptions: { strokeColor: "#004c25", strokeWeight: 5, strokeOpacity: 0.85 },
          });
          renderers.push(renderer);
          void new maps.DirectionsService()
            .route({
              origin: route.origin,
              destination: route.destination,
              travelMode: maps.TravelMode.DRIVING,
            })
            .then((result) => {
              if (!active) return;
              renderer.setDirections(result);
              const leg = result.routes?.[0]?.legs?.[0];
              onRouteSummary?.(
                leg?.distance && leg.duration
                  ? { distance: leg.distance.text, duration: leg.duration.text }
                  : null,
              );
            })
            .catch(() => {
              if (active) onRouteSummary?.(null);
            });
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Map unavailable.");
      });
    return () => {
      active = false;
      window.removeEventListener("rescue-map-auth-error", authError);
      markers.forEach((marker) => marker.setMap(null));
      renderers.forEach((renderer) => renderer.setMap(null));
      infoWindows.forEach((w) => w.close());
    };
  }, [key, channel, points, retry, route, onRouteSummary]);
  return (
    <div
      className={`relative overflow-hidden rounded-md border bg-muted ${compact ? "h-64" : "h-[420px]"}`}
    >
      <div ref={ref} className="absolute inset-0" aria-label="Rescue locations map" />
      {!ready && (
        <div className="absolute inset-0 grid place-items-center bg-map-pattern">
          <div className="max-w-xs rounded-md border bg-background/95 p-4 text-center text-sm">
            <MapPin className="mx-auto mb-2 size-5 text-primary" />
            <p role="status">{error || "Loading rescue locations…"}</p>
            {error && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  mapLoader = undefined;
                  document.getElementById("rescuerelay-google-maps")?.remove();
                  setRetry((v) => v + 1);
                }}
              >
                <RefreshCw /> Retry map
              </Button>
            )}
          </div>
        </div>
      )}
      {ready && (
        <div className="absolute bottom-3 left-3 rounded-md border bg-background/95 px-3 py-2 text-xs shadow-sm">
          {points.length ? (
            <>
              <p className="font-semibold">
                {pickupCount} pickup{pickupCount === 1 ? "" : "s"} · {dropoffCount} food bank
                {dropoffCount === 1 ? "" : "s"}
              </p>
              <ul className="mt-1.5 space-y-1">
                <li className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: MARKER_COLORS.donor.fill }}
                  />
                  Pickup location
                </li>
                <li className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: MARKER_COLORS.recipient.fill }}
                  />
                  Food bank
                </li>
              </ul>
            </>
          ) : (
            <p className="font-medium">
              <MapPin className="mr-1 inline size-3" />
              No rescue locations yet
            </p>
          )}
        </div>
      )}
    </div>
  );
}
