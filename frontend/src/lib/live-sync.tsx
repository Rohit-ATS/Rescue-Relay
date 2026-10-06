import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type LiveStatus = 'Offline' | 'Connecting' | 'Live' | 'Reconnecting';
const LiveContext = createContext<LiveStatus>('Offline');
export const useLiveStatus = () => useContext(LiveContext);

const TABLES = ['donations', 'matches', 'deliveries', 'organizations', 'rescue_events', 'profiles', 'user_roles'];

/** One shared realtime channel for every signed-in page; any saved change refreshes all cached queries. */
export function LiveSyncProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('Offline');

  useEffect(() => {
    if (!userId) { setStatus('Offline'); return; }
    let queued: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const invalidate = () => { clearTimeout(queued); queued = setTimeout(() => void queryClient.invalidateQueries(), 150); };
    const connect = async () => {
      const { data: s } = await supabase.auth.getSession();
      if (s.session) supabase.realtime.setAuth(s.session.access_token);
      if (disposed) return;
      setStatus('Connecting');
      let ch = supabase.channel(`rescue-live-${userId}-${Date.now()}`);
      for (const table of TABLES) ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, invalidate);
      channel = ch;
      ch.subscribe((st) => {
        if (disposed) return;
        if (st === 'SUBSCRIBED') { setStatus('Live'); invalidate(); }
        else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') {
          setStatus('Reconnecting');
          clearTimeout(retry);
          retry = setTimeout(() => { if (channel) void supabase.removeChannel(channel); channel = null; void connect(); }, 3000);
        }
      });
    };
    void connect();
    const onVisible = () => { if (document.visibilityState === 'visible') invalidate(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', invalidate);
    return () => {
      disposed = true; clearTimeout(queued); clearTimeout(retry);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', invalidate);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);

  return <LiveContext.Provider value={status}>{children}</LiveContext.Provider>;
}
