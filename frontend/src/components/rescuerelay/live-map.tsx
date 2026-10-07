import { useEffect, useRef, useState } from "react";
import { ExternalLink, MapPin, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchDrivingRoute } from "@/lib/routing";
import { formatMiles, formatMinutes } from "@/lib/geo";

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

/** Brand tokens, resolved to hex because mapping APIs cannot read CSS custom properties. */
const MARKER_COLORS = {
  donor: { fill: "#f2612b", ring: "#ffffff" },
  recipient: { fill: "#004c25", ring: "#ffffff" },
} as const;

const MARKER_SIZE = 40;

/** A quiet basemap styling for Google Maps. */
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

/** A teardrop pin carrying a glyph, drawn as SVG string. */
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
  return `https://www.google.com/maps/search/?api=1&query=Des+Moines,+IA`;
}

function ensureLeafletCss() {
  if (typeof document === "undefined") return;
  if (document.getElementById("rescuerelay-leaflet-css")) return;
  const link = document.createElement("link");
  link.id = "rescuerelay-leaflet-css";
  link.rel = "stylesheet";
  link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  document.head.appendChild(link);

  const style = document.createElement("style");
  style.id = "rescuerelay-leaflet-custom-style";
  style.textContent = `
    .leaflet-popup-content-wrapper {
      background: #ffffff !important;
      border-radius: 6px !important;
      box-shadow: 0 4px 14px rgba(0,0,0,0.12) !important;
      border: 1px solid rgba(0,0,0,0.08) !important;
      padding: 0 !important;
    }
    .leaflet-popup-content {
      margin: 10px 12px !important;
      line-height: 1.4 !important;
    }
    .leaflet-popup-tip {
      background: #ffffff !important;
    }
    .rescuerelay-marker-wrapper {
      filter: drop-shadow(0 2px 5px rgba(0,0,0,0.3));
      transition: transform 0.15s ease;
    }
    .rescuerelay-marker-wrapper:hover {
      transform: scale(1.1);
    }
  `;
  document.head.appendChild(style);
}

let mapLoader: Promise<void> | undefined;
let googleMapsAuthFailed = false;
/** Why the OpenStreetMap renderer is in use, so the badge can say rather than hide it. */
type GoogleSkipReason = "no-key" | "rejected-domain" | "unreachable";
let googleSkipReason: GoogleSkipReason | null = null;

export function resetGoogleMapsStateForTesting() {
  mapLoader = undefined;
  googleMapsAuthFailed = false;
  googleSkipReason = null;
  googleWarningLogged = false;
}

function loadGoogleMaps(key: string, channel: string) {
  if (window.google?.maps.Map) return Promise.resolve();
  if (mapLoader) return mapLoader;
  mapLoader = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Map loading timed out.")), 15000);
    window.initRescueRelayMap = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    window.gm_authFailure = () => {
      googleMapsAuthFailed = true;
      // Google authorised the key but not this origin: the referrer allow-list.
      googleSkipReason = "rejected-domain";
      window.dispatchEvent(new Event("rescue-map-auth-error"));
    };
    const script = document.createElement("script");
    script.id = "rescuerelay-google-maps";
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&callback=initRescueRelayMap&channel=${encodeURIComponent(channel)}`;
    script.onerror = () => {
      window.clearTimeout(timeout);
      mapLoader = undefined;
      script.remove();
      googleMapsAuthFailed = true;
      googleSkipReason = googleSkipReason ?? "unreachable";
      window.dispatchEvent(new Event("rescue-map-auth-error"));
      reject(new Error("Google Maps script failed to load."));
    };
    document.head.appendChild(script);
  });
  return mapLoader;
}

/** Logged once, so the cause stays diagnosable without an error sitting over a working map. */
let googleWarningLogged = false;
function warnGoogleUnavailable() {
  if (googleWarningLogged) return;
  googleWarningLogged = true;
  const origin = typeof window === "undefined" ? "this origin" : window.location.origin;
  console.warn(
    `[RescueRelay] Google Maps declined to render for ${origin}, so OpenStreetMap is rendering instead. ` +
      "The map is fully functional either way. To use Google, check in Google Cloud Console that " +
      `${origin} is listed under the key's Application restrictions -> Websites, that the Maps ` +
      "JavaScript API is enabled, and that billing is active. Google logs the exact error code to " +
      "this console just above: https://developers.google.com/maps/documentation/javascript/error-messages",
  );
}

const SKIP_EXPLANATIONS: Record<GoogleSkipReason, string> = {
  "no-key": "No Google Maps key configured, so the keyless OpenStreetMap renderer is used.",
  "rejected-domain":
    "Google Maps is unavailable for this domain, so OpenStreetMap is rendering instead. Both show the same rescues and road routes. The browser console explains how to enable Google.",
  unreachable: "Google Maps could not be reached, so the keyless OpenStreetMap renderer is used.",
};

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
  const [mapEngine, setMapEngine] = useState<"google" | "osm">("google");
  const [skipReason, setSkipReason] = useState<GoogleSkipReason | null>(null);

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
  const channel =
    import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID"] || "rescuerelay";

  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;
    const markers: Array<{ setMap: (map: unknown) => void }> = [];
    const renderers: Array<{ setMap: (map: unknown) => void }> = [];
    const infoWindows: Array<{ close: () => void }> = [];

    setError("");
    setReady(false);

    async function initLeafletMap() {
      if (!active || !ref.current) return;
      ensureLeafletCss();
      const L = (await import("leaflet")).default;
      if (!active || !ref.current) return;

      ref.current.innerHTML = "";
      const container = document.createElement("div");
      container.style.width = "100%";
      container.style.height = "100%";
      ref.current.appendChild(container);

      const valid = pointsRef.current.filter(
        (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng),
      );
      const center = valid[0] ?? { lat: 41.5908, lng: -93.6208 };

      const leafletMap = L.map(container, {
        center: [center.lat, center.lng],
        zoom: 12,
        zoomControl: true,
        // OpenStreetMap asks for visible credit, so the control stays on.
        attributionControl: true,
      });

      // CARTO's basemaps now require an API key and watermark every tile without one.
      // OpenStreetMap's standard tiles are keyless, which keeps the map working on any
      // deployment with no credentials — the same principle as the geocoding chain.
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(leafletMap);

      const markerLayer = L.featureGroup().addTo(leafletMap);

      valid.forEach((p) => {
        const svg = createMarkerSvg(p.kind);
        const icon = L.divIcon({
          className: "",
          html: `<div class="rescuerelay-marker-wrapper" style="width:28px;height:40px;cursor:pointer;">${svg}</div>`,
          iconSize: [28, 40],
          iconAnchor: [14, 40],
          popupAnchor: [0, -38],
        });

        const marker = L.marker([p.lat, p.lng], {
          icon,
          zIndexOffset: p.kind === "donor" ? 100 : 50,
        });
        const externalLink = getGoogleMapsDirectionsUrl([p]);
        const popupContent =
          `<div style="font:500 13px/1.45 system-ui,sans-serif;color:#0a1b11;max-width:220px">` +
          `<div style="font-weight:700;margin-bottom:2px">${escapeHtml(p.label)}</div>` +
          `<div style="color:${MARKER_COLORS[p.kind].fill};font-size:11px;letter-spacing:.04em;text-transform:uppercase">${p.kind === "donor" ? "Pickup" : "Food bank"}</div>` +
          `<a href="${externalLink}" target="_blank" rel="noreferrer" style="display:inline-block;color:#004c25;font-size:11px;font-weight:600;margin-top:4px;text-decoration:underline">Open in Google Maps →</a>` +
          `</div>`;

        marker.bindPopup(popupContent, { closeButton: false, offset: [0, -8] });
        markerLayer.addLayer(marker);
      });

      if (valid.length > 1) {
        leafletMap.fitBounds(markerLayer.getBounds(), { padding: [45, 45], maxZoom: 15 });
      }

      const routeData = routeRef.current;
      if (routeData) {
        // Drawn immediately as a straight dashed line so the pair is connected while the
        // road geometry is fetched, then replaced once the real route arrives.
        const provisional = L.polyline(
          [
            [routeData.origin.lat, routeData.origin.lng],
            [routeData.destination.lat, routeData.destination.lng],
          ],
          { color: "#004c25", weight: 4, opacity: 0.35, dashArray: "8, 8" },
        ).addTo(leafletMap);

        void fetchDrivingRoute(
          { latitude: routeData.origin.lat, longitude: routeData.origin.lng },
          { latitude: routeData.destination.lat, longitude: routeData.destination.lng },
        ).then((driving) => {
          if (!active) return;
          provisional.remove();

          // A casing under the route keeps it legible over busy streets.
          L.polyline(driving.path, { color: "#ffffff", weight: 9, opacity: 0.9 }).addTo(leafletMap);
          L.polyline(driving.path, {
            color: "#004c25",
            weight: 5,
            opacity: 0.95,
            lineJoin: "round",
            lineCap: "round",
            // Only a fallback stays dashed, so a straight line never reads as a real route.
            ...(driving.followsRoads ? {} : { dashArray: "8, 8", opacity: 0.6 }),
          }).addTo(leafletMap);

          leafletMap.fitBounds(L.latLngBounds(driving.path), { padding: [45, 45], maxZoom: 15 });

          onRouteSummaryRef.current?.({
            distance: formatMiles(driving.distanceMiles),
            duration: formatMinutes(driving.durationMinutes),
            followsRoads: driving.followsRoads,
          });
        });
      }

      setMapEngine("osm");
      setSkipReason(googleSkipReason);
      setReady(true);

      cleanup = () => {
        leafletMap.remove();
      };
    }

    async function initGoogleMap() {
      try {
        await loadGoogleMaps(key, channel);
        const maps = window.google?.maps;
        if (!active || !maps || !ref.current) return;

        ref.current.innerHTML = "";
        const valid = pointsRef.current.filter(
          (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng),
        );

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
            icon: googleMarkerIcon(p.kind),
            zIndex: p.kind === "donor" ? 2 : 1,
          });
          marker.addListener("click", () => {
            const externalLink = getGoogleMapsDirectionsUrl([p]);
            info.setContent(
              `<div style="font:500 13px/1.45 system-ui,sans-serif;color:#0a1b11;max-width:220px">` +
                `<div style="font-weight:700;margin-bottom:2px">${escapeHtml(p.label)}</div>` +
                `<div style="color:${MARKER_COLORS[p.kind].fill};font-size:11px;letter-spacing:.04em;text-transform:uppercase">${p.kind === "donor" ? "Pickup" : "Food bank"}</div>` +
                `<a href="${externalLink}" target="_blank" rel="noreferrer" style="display:inline-block;color:#004c25;font-size:11px;font-weight:600;margin-top:4px;text-decoration:underline">Open in Google Maps →</a>` +
                `</div>`,
            );
            info.open({ map, anchor: marker });
          });
          markers.push(marker);
        });

        if (valid.length > 1) map.fitBounds(bounds, 45);
        setMapEngine("google");
        setReady(true);

        const routeData = routeRef.current;
        if (routeData) {
          const renderer = new maps.DirectionsRenderer({
            map,
            suppressMarkers: true,
            preserveViewport: false,
            polylineOptions: { strokeColor: "#004c25", strokeWeight: 5, strokeOpacity: 0.85 },
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
                  ? { distance: leg.distance.text, duration: leg.duration.text }
                  : null,
              );
            })
            .catch(() => {
              if (active) onRouteSummaryRef.current?.(null);
            });
        }
      } catch {
        if (active) {
          await initLeafletMap();
        }
      }
    }

    const authErrorHandler = () => {
      if (active) {
        googleMapsAuthFailed = true;
        warnGoogleUnavailable();
        void initLeafletMap();
      }
    };

    window.addEventListener("rescue-map-auth-error", authErrorHandler);

    // Leaflet needs no credentials, so it renders whenever Google cannot: no key
    // configured, or a key whose referrer restrictions reject this origin.
    if (!key || googleMapsAuthFailed) {
      if (!key) googleSkipReason = "no-key";
      void initLeafletMap();
    } else {
      void initGoogleMap();
    }

    return () => {
      active = false;
      window.removeEventListener("rescue-map-auth-error", authErrorHandler);
      markers.forEach((marker) => marker.setMap(null));
      renderers.forEach((renderer) => renderer.setMap(null));
      infoWindows.forEach((w) => w.close());
      cleanup?.();
    };
  }, [key, channel, pointsKey, retry, routeKey, customKey]);

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
            <p role="status">{error || "Loading rescue locations…"}</p>
            {error && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  mapLoader = undefined;
                  googleMapsAuthFailed = false;
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
          <div
            className="rounded border bg-background/90 px-2 py-0.5 text-[10px] text-muted-foreground shadow-sm backdrop-blur-sm"
            title={
              mapEngine === "osm"
                ? SKIP_EXPLANATIONS[skipReason ?? "no-key"]
                : "Rendered by Google Maps"
            }
          >
            {mapEngine === "google" ? "Google Maps" : "OpenStreetMap"}
          </div>
          <a
            href={externalMapUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded border bg-background/90 px-2 py-0.5 text-[10px] font-medium text-foreground shadow-sm backdrop-blur-sm transition hover:bg-background hover:text-primary"
            title="Open in Google Maps"
          >
            <span>Open in Google Maps</span>
            <ExternalLink className="size-2.5 opacity-70" />
          </a>
        </div>
      )}
    </div>
  );
}
