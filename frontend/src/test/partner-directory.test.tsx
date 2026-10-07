import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PartnerDirectory } from "@/components/rescuerelay/workspace-cards";
import type { FoodBank, PartnerSummary } from "@/lib/rescue-opportunities";

const SUMMARY: PartnerSummary = {
  totalRescues: 4,
  completedRescues: 3,
  poundsMoved: 540,
  activeRescues: 1,
};

function partner(
  over: Partial<FoodBank & { milesAway?: number }> = {},
): FoodBank & { milesAway?: number } {
  return {
    id: "org-1",
    name: "Riverbend Food Pantry",
    type: "recipient",
    address: "2220 E 17th St, Des Moines, IA",
    latitude: 41.614357,
    longitude: -93.591134,
    coldStorage: true,
    capacityLbs: 420,
    householdsServed: 310,
    acceptedCategories: ["prepared meals", "produce"],
    verificationStatus: "verified",
    phone: "515-555-0141",
    contactEmail: "intake@riverbendpantry-qa.org",
    website: "https://riverbendpantry-qa.org",
    hoursNote: "Mon-Sat 8am-5pm",
    photoUrl: null,
    ...over,
  };
}

function renderDirectory(
  partners = [partner()],
  props: Partial<Parameters<typeof PartnerDirectory>[0]> = {},
) {
  const onVerify = vi.fn();
  const onRequestLocation = vi.fn();
  render(
    <PartnerDirectory
      partners={partners}
      coordinator={false}
      busy={false}
      locationShared={false}
      locating={false}
      viewer={null}
      summarize={() => SUMMARY}
      onVerify={onVerify}
      onRequestLocation={onRequestLocation}
      {...props}
    />,
  );
  return { onVerify, onRequestLocation };
}

describe("Partner directory", () => {
  it("shows the partner photo above the card when one is set", () => {
    renderDirectory([partner({ photoUrl: "https://example.test/riverbend.jpg" })]);

    const photo = screen.getByRole("img", { name: /riverbend food pantry, food bank/i });
    expect(photo).toHaveAttribute("src", "https://example.test/riverbend.jpg");
  });

  it("draws a placeholder instead of a broken frame when a partner has no photo", () => {
    renderDirectory([partner({ photoUrl: null })]);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("No photo yet")).toBeInTheDocument();
  });

  // The name and the View details button already open the partner; a photo that was
  // also a control would be a third target with the same name.
  it("leaves the photo out of the accessible controls", () => {
    renderDirectory([partner({ photoUrl: "https://example.test/riverbend.jpg" })]);

    expect(
      screen.getAllByRole("button", { name: /view details for riverbend food pantry/i }),
    ).toHaveLength(1);
  });

  it("opens a partner profile from the View details button", async () => {
    const user = userEvent.setup();
    renderDirectory();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /view details for riverbend food pantry/i }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Riverbend Food Pantry" }),
    ).toBeInTheDocument();
  });

  it("asks for location before calculating a route to the selected food bank", async () => {
    const user = userEvent.setup();
    const { onRequestLocation } = renderDirectory();

    await user.click(screen.getByRole("button", { name: /view details for riverbend/i }));
    await user.click(screen.getByRole("button", { name: /use my location for shortest route/i }));

    expect(onRequestLocation).toHaveBeenCalledTimes(1);
  });

  it("opens the same profile from the partner name", async () => {
    const user = userEvent.setup();
    renderDirectory();

    await user.click(screen.getByRole("button", { name: "Riverbend Food Pantry" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("shows the contact details a donor needs to call ahead", async () => {
    const user = userEvent.setup();
    renderDirectory();
    await user.click(screen.getByRole("button", { name: /view details for/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("link", { name: "515-555-0141" })).toHaveAttribute(
      "href",
      "tel:5155550141",
    );
    expect(
      within(dialog).getByRole("link", { name: /intake@riverbendpantry-qa\.org/ }),
    ).toHaveAttribute("href", "mailto:intake@riverbendpantry-qa.org");
    expect(within(dialog).getByText("Mon-Sat 8am-5pm")).toBeInTheDocument();
  });

  it("says so once when no contact details are on file, rather than three empty rows", async () => {
    const user = userEvent.setup();
    renderDirectory([partner({ phone: "", contactEmail: "", hoursNote: "", website: "" })]);
    await user.click(screen.getByRole("button", { name: /view details for/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/no contact details on file/i)).toBeInTheDocument();
    expect(within(dialog).queryByText("Phone")).not.toBeInTheDocument();
  });

  it("shows only the contact rows that have a value", async () => {
    const user = userEvent.setup();
    renderDirectory([partner({ contactEmail: "", hoursNote: "", website: "" })]);
    await user.click(screen.getByRole("button", { name: /view details for/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Phone")).toBeInTheDocument();
    expect(within(dialog).queryByText("Email")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Hours")).not.toBeInTheDocument();
  });

  it("does not repeat the address inside the contact list", async () => {
    const user = userEvent.setup();
    renderDirectory();
    await user.click(screen.getByRole("button", { name: /view details for/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText("2220 E 17th St, Des Moines, IA")).toHaveLength(1);
  });

  it("reports the rescue record for the partner", async () => {
    const user = userEvent.setup();
    renderDirectory();
    await user.click(screen.getByRole("button", { name: /view details for/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("540 lb")).toBeInTheDocument();
  });

  it("filters to donors without dropping them from the directory", async () => {
    const user = userEvent.setup();
    renderDirectory([
      partner(),
      partner({ id: "org-2", name: "Court Avenue Kitchen", type: "donor" }),
    ]);

    expect(screen.getByRole("button", { name: /all partners \(2\)/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /donors \(1\)/i }));

    expect(screen.getByRole("button", { name: "Court Avenue Kitchen" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Riverbend Food Pantry" })).not.toBeInTheDocument();
  });

  it("searches by name", async () => {
    const user = userEvent.setup();
    renderDirectory([
      partner(),
      partner({ id: "org-2", name: "Court Avenue Kitchen", type: "donor" }),
    ]);

    await user.type(screen.getByLabelText(/search partners/i), "court");

    expect(screen.getByRole("button", { name: "Court Avenue Kitchen" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Riverbend Food Pantry" })).not.toBeInTheDocument();
  });

  it("hides verification controls from non-coordinators", () => {
    renderDirectory([partner({ verificationStatus: "pending" })], { coordinator: false });
    expect(screen.queryByRole("button", { name: /^verify$/i })).not.toBeInTheDocument();
  });

  it("gives coordinators verification controls that do not open the profile", async () => {
    const user = userEvent.setup();
    const { onVerify } = renderDirectory([partner({ verificationStatus: "pending" })], {
      coordinator: true,
    });

    await user.click(screen.getByRole("button", { name: /^verify$/i }));

    expect(onVerify).toHaveBeenCalledWith("org-1", "verified");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
