import { useEffect, useRef, useState } from "react";
import { ExternalLink, Key, MapPin, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

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

export type MapRoute = {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
};

/** Brand tokens, resolved to hex for Google Maps markers and overlays. */
const MARKER_COLORS = {
  donor: { fill: "#f2612b", ring: "#ffffff" },
  recipient: { fill: "#004c25", ring: "#ffffff" },
} as const;

const MARKER_SIZE = 40;

/** Basemap styling for Google Maps. */
const BASEMAP_STYLE = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#eceade" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#bed4da" }] },
  { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#ffffff" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#dcd8c6" }] },
  { featureType: "road.highway", elementType: "geometry.fill", stylers: [{ color: "#fdf6dd" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#e4ca84" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#d9e4cd" }] },
  {
    featureType: "administrative",
    elementType: "labels.text.fill",
    stylers: [{ color: "#4a4f46" }],
  },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#6f736a" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#6b8b93" }] },
];

/** Teardrop pin carrying a glyph, drawn as SVG string for Google Maps. */
function createMarkerSvg(kind: MapPoint["kind"]) {
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
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">' +
    '<path d="M14 39.2C14 39.2 26.4 23.6 26.4 14.4 26.4 7.5 20.9 1.9 14 1.9S1.6 7.5 1.6 14.4C1.6 23.6 14 39.2 14 39.2Z" ' +
    'fill="' +
    fill +
    '" stroke="' +
    ring +
    '" stroke-width="2.2" stroke-linejoin="round"/>' +
    glyph +
    "</svg>"
  );
}

function googleMarkerIcon(kind: MapPoint["kind"]) {
  const svg = createMarkerSvg(kind);
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new (window.google as NonNullable<Window["google"]>).maps.Size(28, MARKER_SIZE),
    anchor: new (window.google as NonNullable<Window["google"]>).maps.Point(14, MARKER_SIZE),
  };
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

export function getGoogleMapsDirectionsUrl(points: MapPoint[], route?: MapRoute): string {
  if (route) {
    return `https://www.google.com/maps/dir/?api=1&origin=${route.origin.lat},${route.origin.lng}&destination=${route.destination.lat},${route.destination.lng}&travelmode=driving`;
  }
  if (points.length === 1 && points[0]) {
    return `https://www.google.com/maps/search/?api=1&query=${points[0].lat},${points[0].lng}`;
  }
  if (points.length > 1) {
    const p1 = points[0];
    const p2 = points[points.length - 1];
    if (p1 && p2) {
      return `https://www.google.com/maps/dir/?api=1&origin=${p1.lat},${p1.lng}&destination=${p2.lat},${p2.lng}&travelmode=driving`;
    }
  }
  return `https://www.google.com/maps/search/?api=1&query=Des+Moines,+IA`;
}

export function getGoogleMapsEmbedUrl(points: MapPoint[], route?: MapRoute): string {
  if (route) {
    return `https://maps.google.com/maps?saddr=${route.origin.lat},${route.origin.lng}&daddr=${route.destination.lat},${route.destination.lng}&hl=en&output=embed`;
  }
  if (points.length === 1 && points[0]) {
    return `https://maps.google.com/maps?q=${points[0].lat},${points[0].lng}&hl=en&z=15&output=embed`;
  }
  if (points.length > 1) {
    const lat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
    const lng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;
    return `https://maps.google.com/maps?q=${lat},${lng}&hl=en&z=12&output=embed`;
  }
  return `https://maps.google.com/maps?q=41.5908,-93.6208&hl=en&z=12&output=embed`;
}

let mapLoader: Promise<void> | undefined;
let googleMapsAuthFailed = false;

export function resetGoogleMapsStateForTesting() {
  mapLoader = undefined;
  googleMapsAuthFailed = false;
}

function loadGoogleMaps(key: string, channel?: string) {
  if (window.google?.maps?.Map) return Promise.resolve();
  if (mapLoader) return mapLoader;
  mapLoader = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Map loading timed out.")), 12000);
    window.initRescueRelayMap = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    window.gm_authFailure = () => {
      googleMapsAuthFailed = true;
      window.dispatchEvent(new Event("rescue-map-auth-error"));
    };
    const script = document.createElement("script");
    script.id = "rescuerelay-google-maps";
    script.async = true;
    const channelParam =
      channel && channel !== "rescuerelay" ? `&channel=${encodeURIComponent(channel)}` : "";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&libraries=places,geometry&loading=async&callback=initRescueRelayMap${channelParam}`;
    script.onerror = () => {
      window.clearTimeout(timeout);
      mapLoader = undefined;
      script.remove();
      googleMapsAuthFailed = true;
      window.dispatchEvent(new Event("rescue-map-auth-error"));
      reject(new Error("Google Maps script failed to load."));
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
  onRouteSummary?:
    | ((summary: { distance: string; duration: string; followsRoads?: boolean } | null) => void)
    | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [configOpen, setConfigOpen] = useState(false);

  const pointsKey = JSON.stringify(points.map((p) => [p.id, p.lat, p.lng, p.label, p.kind]));
  const routeKey = JSON.stringify(route ?? null);

  const pointsRef = useRef(points);
  pointsRef.current = points;
  const routeRef = useRef(route);
  routeRef.current = route;
  const onRouteSummaryRef = useRef(onRouteSummary);
  onRouteSummaryRef.current = onRouteSummary;

  const pickupCount = points.filter((p) => p.kind === "donor").length;
  const dropoffCount = points.length - pickupCount;

  const customKey =
    typeof window !== "undefined" ? localStorage.getItem("rr_google_maps_key") : null;
  const key =
    customKey ||
    import.meta.env["VITE_GOOGLE_MAPS_API_KEY"] ||
    import.meta.env["VITE_GOOGLE_MAPS_BROWSER_KEY"] ||
    import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY"];
  const channel = import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID"];

  useEffect(() => {
    let active = true;
    const markers: Array<{ setMap: (map: unknown) => void }> = [];
    const renderers: Array<{ setMap: (map: unknown) => void }> = [];
    const infoWindows: Array<{ close: () => void }> = [];

    setError("");
    setReady(false);

    function initGoogleEmbed() {
      if (!active || !ref.current) return;
      ref.current.innerHTML = "";
      const valid = pointsRef.current.filter(
        (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng),
      );
      const embedUrl = getGoogleMapsEmbedUrl(valid, routeRef.current);

      const iframe = document.createElement("iframe");
      iframe.title = "Google Maps Live Dispatch";
      iframe.src = embedUrl;
      iframe.className = "absolute inset-0 size-full border-0";
      iframe.loading = "lazy";
      iframe.referrerPolicy = "no-referrer-when-downgrade";
      iframe.allowFullscreen = true;

      ref.current.appendChild(iframe);
      setReady(true);
    }

    async function initGoogleMap() {
      try {
        if (!key) {
          initGoogleEmbed();
          return;
        }

        await loadGoogleMaps(key, channel);
        const maps = window.google?.maps;
        if (!active || !maps || !ref.current) {
          initGoogleEmbed();
          return;
        }

        ref.current.innerHTML = "";
        const valid = pointsRef.current.filter(
          (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng),
        );

        const map = new maps.Map(ref.current, {
          center: valid[0] ?? { lat: 41.5908, lng: -93.6208 },
          zoom: 12,
          clickableIcons: false,
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: true,
          scaleControl: true,
          streetViewControl: false,
          fullscreenControl: true,
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
            icon: googleMarkerIcon(p.kind),
            zIndex: p.kind === "donor" ? 2 : 1,
          });
          marker.addListener("click", () => {
            const externalLink = getGoogleMapsDirectionsUrl([p]);
            info.setContent(
              `<div style="font:500 13px/1.45 system-ui,sans-serif;color:#0a1b11;max-width:240px;padding:4px">` +
                `<div style="font-weight:700;font-size:14px;margin-bottom:2px">${escapeHtml(p.label)}</div>` +
                `<div style="color:${MARKER_COLORS[p.kind].fill};font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px">${p.kind === "donor" ? "Pickup Location" : "Food Bank Partner"}</div>` +
                `<a href="${externalLink}" target="_blank" rel="noreferrer" style="display:inline-block;color:#004c25;font-size:12px;font-weight:600;text-decoration:underline">Open in Google Maps →</a>` +
                `</div>`,
            );
            info.open({ map, anchor: marker });
          });
          markers.push(marker);
        });

        if (valid.length > 1) map.fitBounds(bounds, 45);
        setReady(true);

        const routeData = routeRef.current;
        if (routeData) {
          const renderer = new maps.DirectionsRenderer({
            map,
            suppressMarkers: true,
            preserveViewport: false,
            polylineOptions: { strokeColor: "#004c25", strokeWeight: 5, strokeOpacity: 0.9 },
          });
          renderers.push(renderer);
          void new maps.DirectionsService()
            .route({
              origin: routeData.origin,
              destination: routeData.destination,
              travelMode: maps.TravelMode.DRIVING,
            })
            .then((result) => {
              if (!active) return;
              renderer.setDirections(result);
              const leg = result.routes?.[0]?.legs?.[0];
              onRouteSummaryRef.current?.(
                leg?.distance && leg.duration
                  ? { distance: leg.distance.text, duration: leg.duration.text, followsRoads: true }
                  : null,
              );
            })
            .catch(() => {
              if (active) onRouteSummaryRef.current?.(null);
            });
        }
      } catch {
        if (active) {
          initGoogleEmbed();
        }
      }
    }

    const authErrorHandler = () => {
      if (active) {
        googleMapsAuthFailed = true;
        initGoogleEmbed();
      }
    };

    window.addEventListener("rescue-map-auth-error", authErrorHandler);

    if (googleMapsAuthFailed) {
      initGoogleEmbed();
    } else {
      void initGoogleMap();
    }

    return () => {
      active = false;
      window.removeEventListener("rescue-map-auth-error", authErrorHandler);
      markers.forEach((marker) => marker.setMap(null));
      renderers.forEach((renderer) => renderer.setMap(null));
      infoWindows.forEach((w) => w.close());
    };
  }, [key, channel, pointsKey, retry, routeKey, customKey]);

  function handleSaveKey(e: React.FormEvent) {
    e.preventDefault();
    if (apiKeyInput.trim()) {
      localStorage.setItem("rr_google_maps_key", apiKeyInput.trim());
      toast.success("Google Maps API key saved! Reloading map...");
    } else {
      localStorage.removeItem("rr_google_maps_key");
      toast.info("Cleared custom API key. Using default config.");
    }
    setConfigOpen(false);
    mapLoader = undefined;
    googleMapsAuthFailed = false;
    document.getElementById("rescuerelay-google-maps")?.remove();
    setRetry((v) => v + 1);
  }

  const externalMapUrl = getGoogleMapsDirectionsUrl(points, route);

  return (
    <div
      className={`relative isolate overflow-hidden rounded-md border bg-muted ${compact ? "h-64" : "h-[420px]"}`}
    >
      <div ref={ref} className="absolute inset-0" aria-label="Rescue locations map" />

      {!ready && (
        <div className="absolute inset-0 grid place-items-center bg-map-pattern">
          <div className="max-w-xs rounded-md border bg-background/95 p-4 text-center text-sm shadow-sm">
            <MapPin className="mx-auto mb-2 size-5 text-primary" />
            <p role="status">{error || "Loading Google Maps locations…"}</p>
            {error && (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    mapLoader = undefined;
                    googleMapsAuthFailed = false;
                    document.getElementById("rescuerelay-google-maps")?.remove();
                    setRetry((v) => v + 1);
                  }}
                >
                  <RefreshCw className="mr-1.5 size-3.5" /> Retry
                </Button>
                <Dialog open={configOpen} onOpenChange={setConfigOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Key className="mr-1.5 size-3.5" /> Set API Key
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Configure Google Maps API Key</DialogTitle>
                      <DialogDescription>
                        Paste an authorized Google Maps Platform JavaScript API Key.
                      </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSaveKey} className="space-y-4 pt-2">
                      <div>
                        <Label htmlFor="map-api-key">Google Maps API Key</Label>
                        <Input
                          id="map-api-key"
                          value={apiKeyInput}
                          onChange={(e) => setApiKeyInput(e.target.value)}
                          placeholder="AIzaSy..."
                          className="mt-1.5 font-mono text-xs"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="ghost" onClick={() => setConfigOpen(false)}>
                          Cancel
                        </Button>
                        <Button type="submit">Save Key</Button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </div>
        </div>
      )}

      {ready && (
        <div className="absolute bottom-3 left-3 z-[1000] rounded-md border bg-background/95 px-3 py-2 text-xs shadow-sm backdrop-blur-sm">
          {points.length === 1 && points[0] ? (
            <p className="flex items-center gap-1.5 font-medium">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: MARKER_COLORS[points[0].kind].fill }}
              />
              {points[0].label}
            </p>
          ) : points.length ? (
            <>
              <p className="font-semibold">
                {pickupCount} pickup{pickupCount === 1 ? "" : "s"} · {dropoffCount} food bank
                {dropoffCount === 1 ? "" : "s"}
              </p>
              <ul className="mt-1.5 space-y-1">
                {pickupCount > 0 && (
                  <li className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: MARKER_COLORS.donor.fill }}
                    />
                    Pickup location
                  </li>
                )}
                {dropoffCount > 0 && (
                  <li className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: MARKER_COLORS.recipient.fill }}
                    />
                    Food bank
                  </li>
                )}
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

      {ready && (
        <div className="absolute top-3 right-3 z-[1000] flex items-center gap-1.5">
          <a
            href={externalMapUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded border bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground shadow-sm backdrop-blur-sm transition hover:bg-background hover:text-primary"
            title="Open in Google Maps"
          >
            <MapPin className="size-3 text-primary" />
            <span>Google Maps</span>
            <ExternalLink className="size-2.5 opacity-60" />
          </a>
        </div>
      )}
    </div>
  );
}
