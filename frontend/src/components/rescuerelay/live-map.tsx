import { useEffect, useRef, useState } from 'react';
import { MapPin, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

type MapInstance = { fitBounds: (bounds: unknown, padding?: number) => void };
declare global {
  interface Window {
    initRescueRelayMap?: () => void;
    gm_authFailure?: () => void;
    google?: { maps: {
      Map: new (element: HTMLElement, options: Record<string, unknown>) => MapInstance;
      Marker: new (options: Record<string, unknown>) => { setMap: (map: unknown) => void };
      LatLngBounds: new () => { extend: (point: { lat: number; lng: number }) => void };
    } };
  }
}
export type MapPoint = { id: string; lat: number; lng: number; label: string; kind: 'donor' | 'recipient' };
let mapLoader: Promise<void> | undefined;
function loadMaps(key: string, channel: string) {
  if (window.google?.maps.Map) return Promise.resolve();
  if (mapLoader) return mapLoader;
  mapLoader = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Map loading timed out.')), 20000);
    window.initRescueRelayMap = () => { window.clearTimeout(timeout); resolve(); };
    window.gm_authFailure = () => window.dispatchEvent(new Event('rescue-map-auth-error'));
    const script = document.createElement('script');
    script.id = 'rescuerelay-google-maps'; script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&callback=initRescueRelayMap&channel=${encodeURIComponent(channel)}`;
    script.onerror = () => { window.clearTimeout(timeout); mapLoader = undefined; script.remove(); reject(new Error('Google Maps could not connect.')); };
    document.head.appendChild(script);
  });
  return mapLoader;
}
export function LiveMap({ compact = false, points = [] }: { compact?: boolean; points?: MapPoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const key = import.meta.env['VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY'];
  const channel = import.meta.env['VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID'];
  useEffect(() => {
    let active = true;
    const markers: Array<{ setMap: (map: unknown) => void }> = [];
    const authError = () => { if(active) {setReady(false);setError('Google Maps did not authorize this address. The managed map is available on the RescueRelay Lovable preview and published website.');} };
    window.addEventListener('rescue-map-auth-error', authError);
    setError(''); setReady(false);
    if (!key) { setError('Live map connection is not configured.'); return () => window.removeEventListener('rescue-map-auth-error',authError); }
    void loadMaps(key, channel ?? 'rescuerelay').then(() => {
      const maps = window.google?.maps;
      if (!active || !maps || !ref.current) return;
      const valid = points.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      const map = new maps.Map(ref.current, { center: valid[0] ?? { lat: 41.5908, lng: -93.6208 }, zoom: 12, clickableIcons: false, disableDefaultUI: true, zoomControl: true, styles: [{ featureType: 'poi', stylers: [{ visibility: 'off' }] }] });
      const bounds = new maps.LatLngBounds();
      valid.forEach(p => { bounds.extend(p); markers.push(new maps.Marker({ position: { lat:p.lat,lng:p.lng }, map, title:p.label, label:p.kind==='donor'?'D':'R' })); });
      if (valid.length > 1) map.fitBounds(bounds, 45);
      setReady(true);
    }).catch(err => { if(active) setError(err instanceof Error ? err.message : 'Map unavailable.'); });
    return () => { active = false; window.removeEventListener('rescue-map-auth-error',authError); markers.forEach(marker => marker.setMap(null)); };
  }, [key,channel,points,retry]);
  return <div className={`relative overflow-hidden rounded-md border bg-muted ${compact?'h-64':'h-[420px]'}`}>
    <div ref={ref} className="absolute inset-0" aria-label="Rescue locations map"/>
    {!ready && <div className="absolute inset-0 grid place-items-center bg-map-pattern"><div className="max-w-xs rounded-md border bg-background/95 p-4 text-center text-sm"><MapPin className="mx-auto mb-2 size-5 text-primary"/><p role="status">{error || 'Loading rescue locations…'}</p>{error&&<Button variant="outline" size="sm" className="mt-3" onClick={()=>{mapLoader=undefined;document.getElementById('rescuerelay-google-maps')?.remove();setRetry(v=>v+1);}}><RefreshCw/> Retry map</Button>}</div></div>}
    {ready&&<div className="absolute bottom-3 left-3 rounded-md border bg-background/95 px-3 py-2 text-xs font-medium"><MapPin className="mr-1 inline size-3"/>{points.length?`${points.length} saved locations · D donor / R recipient`:'No rescue locations yet'}</div>}
  </div>;
}
