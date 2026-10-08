import { useCallback, useEffect, useState } from "react";
import type { Coords } from "@/lib/geo";

export type LocationState = {
  /** The viewer's position, or null until they share one. */
  coords: Coords | null;
  status: "idle" | "prompting" | "granted" | "denied" | "unavailable";
  error: string;
  /** Asks the browser for a position. Safe to call repeatedly. */
  request: () => void;
};

type LocationOptions = {
  /** Request permission after loading when no recent location is stored. */
  requestOnLoad?: boolean;
};

const STORAGE_KEY = "rescuerelay-viewer-location";
/** A volunteer's own position only has to be roughly right to rank nearby runs. */
const MAX_AGE_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 10000;

/**
 * The viewer's position, used to rank opportunities by how far away they are.
 *
 * Nothing depends on it: without a position the lists still render, just unsorted
 * by distance. The last position is cached so a reload does not re-prompt.
 */
export function useViewerLocation({ requestOnLoad = false }: LocationOptions = {}): LocationState {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [status, setStatus] = useState<LocationState["status"]>("idle");
  const [error, setError] = useState("");

  const request = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      setError("This browser cannot share a location.");
      return;
    }
    setStatus("prompting");
    setError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        setCoords(next);
        setStatus("granted");
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...next, savedAt: Date.now() }));
        } catch {
          // Caching is a convenience; a failure here changes nothing for the viewer.
        }
      },
      (positionError) => {
        setStatus(
          positionError.code === positionError.PERMISSION_DENIED ? "denied" : "unavailable",
        );
        setError(
          positionError.code === positionError.PERMISSION_DENIED
            ? "Location permission was declined. Opportunities are listed by deadline instead."
            : "Your location could not be determined. Opportunities are listed by deadline instead.",
        );
      },
      { enableHighAccuracy: false, maximumAge: MAX_AGE_MS, timeout: TIMEOUT_MS },
    );
  }, []);

  // Restore the cached position first. When there is none, the dashboard can opt in
  // to asking immediately, so route estimates start from the visitor's location.
  useEffect(() => {
    let restored = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { latitude: number; longitude: number; savedAt: number };
        if (Number.isFinite(saved.latitude) && Number.isFinite(saved.longitude)) {
          restored = true;
          setCoords({ latitude: saved.latitude, longitude: saved.longitude });
          setStatus("granted");
        }
      }
    } catch {
      // Private browsing or blocked storage; the viewer can still share a position.
    }
    if (requestOnLoad && !restored) request();
  }, [request, requestOnLoad]);

  return { coords, status, error, request };
}
