import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (message: { payload: unknown }) => void;

const listeners = new Map<string, Listener>();
const sent: Array<{ event: string; payload: unknown }> = [];
let subscribeCallback: ((status: string) => void) | undefined;

const channel = {
  on: vi.fn((_type: string, filter: { event: string }, fn: Listener) => {
    listeners.set(filter.event, fn);
    return channel;
  }),
  subscribe: vi.fn((cb: (status: string) => void) => {
    subscribeCallback = cb;
    return channel;
  }),
  send: vi.fn((message: { event: string; payload: unknown }) => {
    sent.push({ event: message.event, payload: message.payload });
    return Promise.resolve("ok");
  }),
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { channel: () => channel, removeChannel: () => Promise.resolve("ok") },
}));

const { startDemoSync, publishWorkspace, stopDemoSyncForTesting, isApplyingRemote } =
  await import("@/lib/demo-broadcast");

const workspace = (id: string) => ({ donations: [{ id }] }) as never;

describe("Demo workspace sync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    listeners.clear();
    sent.length = 0;
    subscribeCallback = undefined;
  });

  afterEach(() => {
    stopDemoSyncForTesting();
    vi.useRealTimers();
  });

  // A screen opened second would otherwise sit on seed data forever.
  it("asks the other screens for a snapshot on joining", () => {
    startDemoSync({ read: () => workspace("a"), write: vi.fn() });
    subscribeCallback?.("SUBSCRIBED");

    expect(sent.map((m) => m.event)).toContain("request");
  });

  it("answers another screen's request with its own workspace", () => {
    startDemoSync({ read: () => workspace("mine"), write: vi.fn() });
    subscribeCallback?.("SUBSCRIBED");
    sent.length = 0;

    listeners.get("request")?.({ payload: {} });

    expect(sent).toEqual([{ event: "sync", payload: { donations: [{ id: "mine" }] } }]);
  });

  it("applies a workspace that arrives from another screen", () => {
    const write = vi.fn();
    startDemoSync({ read: () => workspace("mine"), write });
    subscribeCallback?.("SUBSCRIBED");

    listeners.get("sync")?.({ payload: workspace("theirs") });

    expect(write).toHaveBeenCalledWith({ donations: [{ id: "theirs" }] });
    expect(isApplyingRemote()).toBe(false);
  });

  // Two screens answering each other's snapshots would never stop.
  it("does not publish a workspace it has just received", () => {
    startDemoSync({
      read: () => workspace("mine"),
      // The real store publishes from inside its save; this stands in for that.
      write: () => publishWorkspace(workspace("echo")),
    });
    subscribeCallback?.("SUBSCRIBED");
    sent.length = 0;

    listeners.get("sync")?.({ payload: workspace("theirs") });
    vi.advanceTimersByTime(500);

    expect(sent).toEqual([]);
  });

  it("collapses a burst of saves into one message", () => {
    startDemoSync({ read: () => workspace("a"), write: vi.fn() });
    subscribeCallback?.("SUBSCRIBED");
    sent.length = 0;

    publishWorkspace(workspace("1"));
    publishWorkspace(workspace("2"));
    publishWorkspace(workspace("3"));
    vi.advanceTimersByTime(500);

    expect(sent).toEqual([{ event: "sync", payload: { donations: [{ id: "3" }] } }]);
  });
});
