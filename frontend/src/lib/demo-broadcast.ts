import { supabase } from "@/integrations/supabase/client";
import type { WorkspaceData } from "@/lib/demo-store";

/**
 * Shares the demo workspace between browsers over a Supabase Realtime broadcast
 * channel.
 *
 * Why this exists: the deployed site has no server, and the project's auth
 * providers issue no browser session, so every database write is refused by RLS
 * and the client keeps its state in localStorage — which is per-browser. A post
 * made on one screen was invisible on every other.
 *
 * Broadcast carries ephemeral messages between subscribers and never touches the
 * database, so it needs no session and no policy change. That makes it a demo
 * mechanism, not a backend: state still lives in each browser, and nothing
 * survives everyone closing the tab. Give the project a real session and the
 * Supabase path takes over; this is what stands in until then.
 *
 * The whole workspace is sent rather than a diff. It is a few kilobytes, and a
 * snapshot cannot drift out of step the way a missed increment can.
 */

const CHANNEL = "rescuerelay-demo-v1";
/** Supabase caps a broadcast payload; well under it, but a runaway store should not wedge the channel. */
const MAX_PAYLOAD_BYTES = 200_000;
/** Collapses a burst of writes — posting a donation saves several times in a row. */
const PUBLISH_DEBOUNCE_MS = 150;

type Handlers = {
  /** Current workspace, sent when another screen asks for one. */
  read: () => WorkspaceData;
  /** Applies a workspace received from another screen. */
  write: (data: WorkspaceData) => void;
};

type Channel = ReturnType<typeof supabase.channel>;

let channel: Channel | null = null;
let handlers: Handlers | null = null;
let publishTimer: ReturnType<typeof setTimeout> | null = null;
let pending: WorkspaceData | null = null;

/** True while a remote snapshot is being written, so applying it does not echo back. */
let applying = false;
export const isApplyingRemote = () => applying;

function send(event: string, payload: unknown) {
  if (!channel) return;
  const body = JSON.stringify(payload ?? {});
  if (body.length > MAX_PAYLOAD_BYTES) {
    console.warn("[Demo sync] Workspace too large to share; skipping.");
    return;
  }
  void channel.send({ type: "broadcast", event, payload });
}

/**
 * Joins the shared channel. Safe to call repeatedly; only the first call connects.
 *
 * On joining it asks for a snapshot, so a screen opened second catches up with
 * whatever the others already have instead of starting from seed data.
 */
export function startDemoSync(next: Handlers) {
  handlers = next;
  if (channel || typeof window === "undefined") return;

  channel = supabase.channel(CHANNEL, { config: { broadcast: { self: false } } });

  channel.on("broadcast", { event: "sync" }, ({ payload }) => {
    if (!handlers || !payload) return;
    applying = true;
    try {
      handlers.write(payload as WorkspaceData);
    } finally {
      applying = false;
    }
  });

  // Someone just opened a screen; hand them what we have.
  channel.on("broadcast", { event: "request" }, () => {
    if (handlers) send("sync", handlers.read());
  });

  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") send("request", {});
    else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
      console.warn("[Demo sync] Channel unavailable:", status);
  });
}

/** Shares a workspace with every other open screen. */
export function publishWorkspace(data: WorkspaceData) {
  if (!channel || applying) return;
  pending = data;
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    publishTimer = null;
    if (pending) send("sync", pending);
    pending = null;
  }, PUBLISH_DEBOUNCE_MS);
}

/** Leaves the channel. Only used by tests; the app keeps it for the tab's lifetime. */
export function stopDemoSyncForTesting() {
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = null;
  pending = null;
  applying = false;
  if (channel) void supabase.removeChannel(channel);
  channel = null;
  handlers = null;
}
