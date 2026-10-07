import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RelayBoard } from "@/components/rescuerelay/workspace-cards";

const RESCUES = [
  {
    id: "1",
    title: "Hot line prepared meals",
    category: "prepared meals",
    pounds: 180,
    status: "open",
    pickup_address: "400 E Locust St",
    pickup_deadline: "2026-10-07T01:19:00Z",
  },
  {
    id: "2",
    title: "Bakery surplus trays",
    category: "bakery",
    pounds: 90,
    status: "matched",
    pickup_address: "730 3rd St",
    pickup_deadline: "2026-10-06T22:19:00Z",
  },
  {
    id: "3",
    title: "Weekend produce rescue",
    category: "produce",
    pounds: 310,
    status: "delivered",
    pickup_address: "400 E Locust St",
    pickup_deadline: "2026-10-05T23:19:00Z",
  },
  {
    id: "4",
    title: "Late night sandwich trays",
    category: "prepared meals",
    pounds: 70,
    status: "expired",
    pickup_address: "400 E Locust St",
    pickup_deadline: "2026-10-04T23:19:00Z",
  },
];

function renderBoard(rescues = RESCUES) {
  const onOpen = vi.fn();
  render(<RelayBoard rescues={rescues} statusTone={{}} onOpen={onOpen} />);
  return { onOpen };
}

function rows() {
  return screen.getAllByRole("button", { name: /details/i });
}

describe("Relay board", () => {
  it("lists every rescue and counts them", () => {
    renderBoard();
    expect(rows()).toHaveLength(4);
    expect(screen.getByText("4 rescues")).toBeInTheDocument();
  });

  it("narrows the list as the user types", async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.type(screen.getByLabelText(/search rescues/i), "bakery");

    expect(screen.getByText("Bakery surplus trays")).toBeInTheDocument();
    expect(screen.queryByText("Hot line prepared meals")).not.toBeInTheDocument();
  });

  it("reports how many of the total are showing once narrowed", async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.type(screen.getByLabelText(/search rescues/i), "bakery");

    expect(screen.getByText("1 of 4")).toBeInTheDocument();
  });

  it("filters by status with counts on each control", async () => {
    const user = userEvent.setup();
    renderBoard();

    expect(screen.getByRole("button", { name: /in progress 2/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /delivered 1/i }));

    expect(screen.getByText("Weekend produce rescue")).toBeInTheDocument();
    expect(screen.queryByText("Hot line prepared meals")).not.toBeInTheDocument();
  });

  it("combines a search with a status filter", async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.click(screen.getByRole("button", { name: /in progress 2/i }));
    await user.type(screen.getByLabelText(/search rescues/i), "trays");

    expect(screen.getByText("Bakery surplus trays")).toBeInTheDocument();
    // The sandwich trays are expired, so the status filter excludes them.
    expect(screen.queryByText("Late night sandwich trays")).not.toBeInTheDocument();
  });

  it("explains an empty result rather than showing a bare list", async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.type(screen.getByLabelText(/search rescues/i), "zzzzz");

    expect(screen.getByText(/no rescues match that/i)).toBeInTheDocument();
    expect(screen.getByText(/switch the status filter back to all/i)).toBeInTheDocument();
  });

  it("distinguishes an empty board from an over-filtered one", () => {
    renderBoard([]);
    expect(screen.getByText(/no rescues yet/i)).toBeInTheDocument();
  });

  it("opens the rescue the user picked", async () => {
    const user = userEvent.setup();
    const { onOpen } = renderBoard();

    const row = screen.getByText("Bakery surplus trays").closest("div")
      ?.parentElement as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /details/i }));

    expect(onOpen).toHaveBeenCalledWith("2");
  });

  it("marks the active status control for assistive technology", async () => {
    const user = userEvent.setup();
    renderBoard();

    expect(screen.getByRole("button", { name: /^all 4/i })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: /closed 1/i }));
    expect(screen.getByRole("button", { name: /closed 1/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
