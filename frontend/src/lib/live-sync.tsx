import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type LiveStatus = "Offline" | "Connecting" | "Live" | "Reconnecting";

export type LiveState = {
  status: LiveStatus;
  /** When the channel last delivered a saved change, so the UI can show real freshness. */
  lastChangeAt: number | null;
  /** Failed subscribe attempts since the last success; drives the backoff and the UI copy. */
  attempts: number;
};

const LiveContext = createContext<LiveState>({
  status: "Offline",
  lastChangeAt: null,
  attempts: 0,
});

/** Back-compat: existing views read just the status string. */
export const useLiveStatus = () => useContext(LiveContext).status;
export const useLiveState = () => useContext(LiveContext);

/** Every table the workspace query reads; all are in the supabase_realtime publication. */
const TABLES = [
  "donations",
  "matches",
  "deliveries",
  "organizations",
  "rescue_events",
  "profiles",
  "user_roles",
] as const;

/** The one query every authenticated view derives from. Keyed so unrelated caches survive. */
export const WORKSPACE_QUERY_KEY = ["rescue-workspace"] as const;

/** Coalesces the burst of row events a single rescue action produces into one refetch. */
const INVALIDATE_DEBOUNCE_MS = 150;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CEILING_MS = 15000;

/** Full jitter, so many reconnecting clients do not retry in lockstep after an outage. */
export function reconnectDelay(attempts: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BACKOFF_CEILING_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts));
  return Math.round(BACKOFF_BASE_MS + random() * (ceiling - BACKOFF_BASE_MS));
}

/**
 * One shared realtime channel for every signed-in page; any saved change refetches
 * the workspace query.
 *
 * Realtime authorizes RLS against the token handed to `realtime.setAuth`, and that
 * token expires about an hour after sign-in. The subscription keeps looking healthy
 * while silently delivering nothing, so the token is re-applied on every refresh.
 */
export function LiveSyncProvider({
  userId,
  children,
}: {
  userId: string | null;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>("Offline");
  const [lastChangeAt, setLastChangeAt] = useState<number | null>(null);
  const [attempts, setAttempts] = useState(0);
  // Read inside callbacks without making them a dependency of the connect effect.
  const attemptsRef = useRef(0);

  useEffect(() => {
    if (!userId) {
      setStatus("Offline");
      setLastChangeAt(null);
      setAttempts(0);
      attemptsRef.current = 0;
      return;
    }

    let disposed = false;
    let queued: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let channelSeq = 0;

    const invalidate = (fromChange: boolean) => {
      if (fromChange) setLastChangeAt(Date.now());
      clearTimeout(queued);
      queued = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: WORKSPACE_QUERY_KEY });
      }, INVALIDATE_DEBOUNCE_MS);
    };

    /** Keeps realtime's RLS context on a live token; without it updates stop arriving silently. */
    const applyAuth = async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) await supabase.realtime.setAuth(token);
      return Boolean(token);
    };

    const teardownChannel = () => {
      if (!channel) return;
      const stale = channel;
      channel = null;
      void supabase.removeChannel(stale);
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      attemptsRef.current += 1;
      setAttempts(attemptsRef.current);
      setStatus("Reconnecting");
      clearTimeout(retry);
      retry = setTimeout(() => {
        teardownChannel();
        void connect();
      }, reconnectDelay(attemptsRef.current));
    };

    const connect = async () => {
      if (disposed || channel) return;
      setStatus(attemptsRef.current ? "Reconnecting" : "Connecting");

      const authorized = await applyAuth();
      if (disposed) return;
      if (!authorized) {
        // No session yet; the auth listener below reconnects once one lands.
        setStatus("Offline");
        return;
      }

      // Unique per attempt: removeChannel resolves asynchronously, so reusing one topic
      // can collide with the channel a remount or retry has already opened.
      const topic = `rescue-live-${userId}-${++channelSeq}`;
      let next = supabase.channel(topic);
      for (const table of TABLES) {
        next = next.on("postgres_changes", { event: "*", schema: "public", table }, () =>
          invalidate(true),
        );
      }
      channel = next;

      next.subscribe((state) => {
        if (disposed || channel !== next) return;
        if (state === "SUBSCRIBED") {
          attemptsRef.current = 0;
          setAttempts(0);
          setStatus("Live");
          invalidate(false);
        } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
          scheduleReconnect();
        }
      });
    };

    void connect();

    // A rotated token must reach realtime, or RLS-filtered changes stop arriving.
    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (disposed) return;
      if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") {
        void applyAuth().then((authorized) => {
          if (!disposed && authorized && !channel) void connect();
        });
      }
    });

    const onVisible = () => {
      if (document.visibilityState === "visible") invalidate(false);
    };
    const onOnline = () => {
      invalidate(false);
      // The socket may have died while offline without reporting a state change.
      if (!disposed && status !== "Live") {
        teardownChannel();
        void connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    return () => {
      disposed = true;
      clearTimeout(queued);
      clearTimeout(retry);
      authListener.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      teardownChannel();
    };
    // `status` is read only inside onOnline as a hint; re-subscribing on it would churn the channel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, queryClient]);

  const value = useMemo<LiveState>(
    () => ({ status, lastChangeAt, attempts }),
    [status, lastChangeAt, attempts],
  );
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}
