import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { OpportunityBoard, RescueDetailDialog } from "@/components/rescuerelay/workspace-cards";
import type { Opportunity } from "@/lib/rescue-opportunities";

const RESCUE = {
  id: "d1",
  title: "Chilled produce flats",
  category: "produce",
  pounds: 240,
  status: "accepted",
  pickup_address: "1101 Walnut St, Des Moines, IA",
  pickup_deadline: new Date(Date.now() + 3 * 3600_000).toISOString(),
  allergens: "None",
  notes: "Needs insulated bins.",
  storage_required: "refrigerated",
  latitude: 41.5847,
  longitude: -93.6308,
};

const ORGS = [
  {
    id: "org-1",
    name: "Southside Community Table",
    address: "100 Army Post Rd",
    latitude: 41.5264,
    longitude: -93.6175,
  },
];
const MATCHES = [
  {
    id: "m1",
    recipient_org_id: "org-1",
    score: 91,
    explanation: "4.1 miles away · storage ready",
    status: "accepted",
  },
];

function renderDetail(over: Partial<Parameters<typeof RescueDetailDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onOpenWorkspace = vi.fn();
  render(
    <RescueDetailDialog
      rescue={RESCUE}
      matches={MATCHES}
      organizations={ORGS}
      delivery={null}
      statusTone={{}}
      now={Date.now()}
      onClose={onClose}
      onOpenWorkspace={onOpenWorkspace}
      {...over}
    />,
  );
  return { onClose, onOpenWorkspace };
}

describe("Rescue detail dialog", () => {
  it("shows the rescue without leaving the board", () => {
    renderDetail();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Chilled produce flats");
    expect(dialog).toHaveTextContent("1101 Walnut St, Des Moines, IA");
    expect(dialog).toHaveTextContent("240 lb");
  });

  it("carries the food-safety detail a driver needs before accepting", () => {
    renderDetail();
    expect(screen.getByText("Needs insulated bins.")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("lists recipient matches with their scores", () => {
    renderDetail();
    expect(screen.getByText("Southside Community Table")).toBeInTheDocument();
    expect(screen.getByText("91")).toBeInTheDocument();
    expect(screen.getByText(/4.1 miles away/)).toBeInTheDocument();
  });

  it("says so when nothing has matched yet", () => {
    renderDetail({ matches: [] });
    expect(screen.getByText(/no verified recipient matches this yet/i)).toBeInTheDocument();
  });

  it("reports handoff progress once a driver is on it", () => {
    renderDetail({
      delivery: {
        driver_name: "Devon Marsh",
        picked_up_at: new Date().toISOString(),
        delivered_at: null,
      },
    });
    expect(screen.getByText("Devon Marsh")).toBeInTheDocument();
    expect(screen.getByText("Not yet")).toBeInTheDocument();
  });

  it("still offers a way through to the full workspace", async () => {
    const user = userEvent.setup();
    const { onClose, onOpenWorkspace } = renderDetail();

    await user.click(screen.getByRole("button", { name: /open in workspace/i }));

    expect(onOpenWorkspace).toHaveBeenCalledWith("d1");
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing when no rescue is selected", () => {
    renderDetail({ rescue: null });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

const OPPORTUNITY: Opportunity = {
  donationId: "d1",
  title: "Chilled produce flats",
  category: "produce",
  pounds: 240,
  storageRequired: "refrigerated",
  pickupAddress: "1101 Walnut St",
  pickupDeadline: new Date(Date.now() + 3 * 3600_000).toISOString(),
  status: "accepted",
  pickup: { latitude: 41.5847, longitude: -93.6308 },
  foodBank: {
    id: "org-1",
    name: "Southside Community Table",
    type: "recipient",
    address: "100 Army Post Rd",
    latitude: 41.5264,
    longitude: -93.6175,
    coldStorage: true,
    capacityLbs: 600,
    householdsServed: 540,
    acceptedCategories: ["produce"],
    verificationStatus: "verified",
    phone: "",
    contactEmail: "",
    website: "",
    hoursNote: "",
    photoUrl: null,
  },
  destinationConfirmed: true,
  routeMiles: 5.3,
  routeMinutes: 23,
  claimable: true,
  matchId: "m1",
  expired: false,
};

describe("Opportunity route hand-off", () => {
  it("draws the route on the shared map rather than opening a second one", async () => {
    const user = userEvent.setup();
    const onRouteChange = vi.fn();
    render(
      <OpportunityBoard
        opportunities={[OPPORTUNITY]}
        viewer={null}
        now={Date.now()}
        canDrive
        busy={false}
        onOpen={vi.fn()}
        onClaim={vi.fn()}
        onRouteChange={onRouteChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /show route/i }));

    expect(onRouteChange).toHaveBeenCalledWith(expect.objectContaining({ donationId: "d1" }));
    // No map is mounted inside the card itself.
    expect(screen.queryByLabelText(/rescue locations map/i)).not.toBeInTheDocument();
  });

  it("clears the shared route when the same run is toggled off", async () => {
    const user = userEvent.setup();
    const onRouteChange = vi.fn();
    render(
      <OpportunityBoard
        opportunities={[OPPORTUNITY]}
        viewer={null}
        now={Date.now()}
        canDrive
        busy={false}
        onOpen={vi.fn()}
        onClaim={vi.fn()}
        onRouteChange={onRouteChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /show route/i }));
    await user.click(screen.getByRole("button", { name: /hide route/i }));

    expect(onRouteChange).toHaveBeenLastCalledWith(null);
  });
});
