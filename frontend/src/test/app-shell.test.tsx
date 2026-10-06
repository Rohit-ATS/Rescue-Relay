import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/rescuerelay/app-shell";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signOut: vi.fn().mockResolvedValue({}) } },
}));

function renderShell(props: Partial<Parameters<typeof AppShell>[0]> = {}) {
  const onView = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AppShell name="Rosa Lindqvist" role="recipient" view="overview" onView={onView} {...props}>
        <p>Workspace body</p>
      </AppShell>
    </QueryClientProvider>,
  );
  return { onView };
}

/** The desktop rail is the aside whose width class carries the collapse state. */
function rail() {
  return document.querySelector("aside.lg\\:flex") as HTMLElement;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("AppShell sidebar", () => {
  it("starts expanded and shows the navigation labels", () => {
    renderShell();
    expect(rail().className).toContain("w-64");
    expect(screen.getByRole("button", { name: "Opportunities" })).toBeInTheDocument();
  });

  it("collapses to an icon rail and back", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    await waitFor(() => expect(rail().className).toContain("w-[72px]"));

    await user.click(screen.getByRole("button", { name: /expand sidebar/i }));
    await waitFor(() => expect(rail().className).toContain("w-64"));
  });

  it("animates the width rather than snapping between states", () => {
    renderShell();
    expect(rail().className).toContain("transition-[width]");
  });

  it("remembers the collapsed rail across mounts", async () => {
    const user = userEvent.setup();
    const first = renderShell();
    expect(first).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    await waitFor(() => expect(localStorage.getItem("rescuerelay-sidebar-collapsed")).toBe("true"));

    document.body.innerHTML = "";
    renderShell();
    await waitFor(() => expect(rail().className).toContain("w-[72px]"));
  });

  it("keeps navigation reachable to screen readers while collapsed", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: /collapse sidebar/i }));

    // The label is visually hidden, not removed, so the control keeps its name.
    expect(screen.getByRole("button", { name: "Opportunities" })).toBeInTheDocument();
  });

  it("marks the current view for assistive technology", () => {
    renderShell({ view: "partners" });
    expect(screen.getByRole("button", { name: "Partners" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Overview" })).not.toHaveAttribute("aria-current");
  });

  it("reports the selected view to the caller", async () => {
    const user = userEvent.setup();
    const { onView } = renderShell();

    await user.click(screen.getByRole("button", { name: "Driver routes" }));

    expect(onView).toHaveBeenCalledWith("route");
  });
});

describe("AppShell mobile drawer", () => {
  it("slides the drawer in and out", async () => {
    const user = userEvent.setup();
    renderShell();
    const drawer = document.querySelector("aside.lg\\:hidden") as HTMLElement;

    expect(drawer.className).toContain("-translate-x-full");
    await user.click(screen.getByRole("button", { name: /open navigation/i }));
    await waitFor(() => expect(drawer.className).toContain("translate-x-0"));

    await user.click(screen.getByRole("button", { name: /close navigation/i }));
    await waitFor(() => expect(drawer.className).toContain("-translate-x-full"));
  });

  it("closes once a destination is chosen", async () => {
    const user = userEvent.setup();
    renderShell();
    const drawer = document.querySelector("aside.lg\\:hidden") as HTMLElement;

    await user.click(screen.getByRole("button", { name: /open navigation/i }));
    await user.click(within(drawer).getByRole("button", { name: "Impact" }));

    await waitFor(() => expect(drawer.className).toContain("-translate-x-full"));
  });
});

describe("AppShell header", () => {
  it("names the current view instead of repeating a greeting", () => {
    renderShell({ view: "activity" });
    expect(screen.getByRole("heading", { name: "Activity" })).toBeInTheDocument();
  });

  it("puts the account and its role behind one menu", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: /account menu/i }));

    expect(await screen.findByText("Rosa Lindqvist")).toBeInTheDocument();
    expect(screen.getByText(/recipient/i)).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /sign out/i })).toBeInTheDocument();
  });
});
