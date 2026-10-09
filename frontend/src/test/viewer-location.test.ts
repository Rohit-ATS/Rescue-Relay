import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useViewerLocation } from "@/lib/use-viewer-location";

const DES_MOINES = { latitude: 41.584932, longitude: -93.621926 };
const STORAGE_KEY = "rescuerelay-viewer-location";

beforeEach(() => localStorage.removeItem(STORAGE_KEY));
afterEach(() => {
  localStorage.removeItem(STORAGE_KEY);
  vi.unstubAllGlobals();
});

describe("Viewer location", () => {
  it("starts from the workspace's own address when one is given", async () => {
    const { result } = renderHook(() => useViewerLocation({ homeLocation: DES_MOINES }));

    await waitFor(() => expect(result.current.coords).toEqual(DES_MOINES));
    expect(result.current.usingFallback).toBe(true);
  });

  // A visitor who shared a real position on an earlier visit would otherwise come
  // back to an Iowa demo ranked against a device two thousand miles away.
  it("prefers that address over a cached device position", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ latitude: 37.77, longitude: -122.42, savedAt: Date.now() }),
    );

    const { result } = renderHook(() => useViewerLocation({ homeLocation: DES_MOINES }));

    await waitFor(() => expect(result.current.coords).toEqual(DES_MOINES));
  });

  it("still restores the cached position when no address is given", async () => {
    const cached = { latitude: 37.77, longitude: -122.42 };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...cached, savedAt: Date.now() }));

    const { result } = renderHook(() => useViewerLocation());

    await waitFor(() => expect(result.current.coords).toEqual(cached));
    expect(result.current.usingFallback).toBe(false);
  });

  it("hands over to the real position once the viewer shares one", async () => {
    const real = { latitude: 42.5, longitude: -92.4 };
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (ok: (p: { coords: typeof real }) => void) => ok({ coords: real }),
      },
    });

    const { result } = renderHook(() => useViewerLocation({ homeLocation: DES_MOINES }));
    await waitFor(() => expect(result.current.usingFallback).toBe(true));

    result.current.request();

    await waitFor(() => expect(result.current.coords).toEqual(real));
    expect(result.current.usingFallback).toBe(false);
  });

  it("does not prompt on load when an address stands in for the device", async () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });

    renderHook(() => useViewerLocation({ requestOnLoad: false, homeLocation: DES_MOINES }));

    await waitFor(() => expect(getCurrentPosition).not.toHaveBeenCalled());
  });
});
