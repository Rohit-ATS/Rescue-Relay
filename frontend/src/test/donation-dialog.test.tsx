import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createDonation = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@tanstack/react-start", () => ({ useServerFn: () => createDonation }));
vi.mock("@/lib/rescue.functions", () => ({ createDonation: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: (m: string) => toastError(m), success: (m: string) => toastSuccess(m) },
}));

import { DonationDialog } from "@/components/rescuerelay/donation-dialog";

async function openDialog() {
  const user = userEvent.setup();
  render(<DonationDialog onCreated={vi.fn().mockResolvedValue(undefined)} />);
  await user.click(screen.getByRole("button", { name: /post surplus/i }));
  await screen.findByRole("dialog");
  return user;
}

describe("Donation dialog", () => {
  beforeEach(() => {
    createDonation.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
  });

  it("groups the form into three numbered steps", async () => {
    await openDialog();

    expect(screen.getByRole("heading", { name: /what you are donating/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /where and when/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /food safety/i })).toBeInTheDocument();
  });

  it("explains how long volunteers get to collect", async () => {
    await openDialog();
    expect(screen.getByText(/leaves volunteers/i)).toBeInTheDocument();
  });

  it("blocks a past deadline before it reaches the server", async () => {
    const user = await openDialog();
    createDonation.mockClear();

    await user.clear(screen.getByLabelText(/pickup deadline/i));
    await user.type(screen.getByLabelText(/pickup deadline/i), "2020-01-01T09:00");

    await waitFor(() =>
      expect(screen.getByText(/this time has already passed/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /post and find matches/i })).toBeDisabled();
    expect(createDonation).not.toHaveBeenCalled();
  });

  it("submits the details the server expects", async () => {
    const user = await openDialog();
    createDonation.mockResolvedValueOnce({ id: "d1", matches: 3 });

    await user.type(screen.getByLabelText(/what is available/i), "Hot line meals");
    await user.type(screen.getByLabelText(/pickup address/i), "400 E Locust St, Des Moines, IA");
    await user.type(screen.getByLabelText(/allergen/i), "Contains dairy");
    await user.click(screen.getByRole("button", { name: /post and find matches/i }));

    await waitFor(() => expect(createDonation).toHaveBeenCalledTimes(1));
    const payload = createDonation.mock.calls[0]?.[0]?.data;
    expect(payload).toMatchObject({
      title: "Hot line meals",
      category: "prepared meals",
      pounds: 150,
      pickupAddress: "400 E Locust St, Des Moines, IA",
      storageRequired: "refrigerated",
    });
    // The deadline must leave the browser as an instant, not local wall-clock text.
    expect(payload.pickupDeadline).toMatch(/\dT.*Z$/);
  }, 10_000);

  it("reports how many recipients can take it", async () => {
    const user = await openDialog();
    createDonation.mockResolvedValueOnce({ id: "d1", matches: 3 });

    await user.type(screen.getByLabelText(/what is available/i), "Hot line meals");
    await user.type(screen.getByLabelText(/pickup address/i), "400 E Locust St");
    await user.type(screen.getByLabelText(/allergen/i), "None");
    await user.click(screen.getByRole("button", { name: /post and find matches/i }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/3 verified recipients/i)),
    );
  });

  it("says plainly when nothing matched, rather than claiming success", async () => {
    const user = await openDialog();
    createDonation.mockResolvedValueOnce({ id: "d1", matches: 0 });

    await user.type(screen.getByLabelText(/what is available/i), "Hot line meals");
    await user.type(screen.getByLabelText(/pickup address/i), "400 E Locust St");
    await user.type(screen.getByLabelText(/allergen/i), "None");
    await user.click(screen.getByRole("button", { name: /post and find matches/i }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/no verified recipient/i)),
    );
  });

  it("surfaces a server error instead of closing silently", async () => {
    const user = await openDialog();
    createDonation.mockRejectedValueOnce(new Error("Address lookup is temporarily unavailable."));

    await user.type(screen.getByLabelText(/what is available/i), "Hot line meals");
    await user.type(screen.getByLabelText(/pickup address/i), "nowhere");
    await user.type(screen.getByLabelText(/allergen/i), "None");
    await user.click(screen.getByRole("button", { name: /post and find matches/i }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Address lookup is temporarily unavailable."),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("Donation dialog safety defaults", () => {
  it("offers allergens and handling notes as examples, not as prefilled answers", async () => {
    await openDialog();

    // Prefilled values were being posted as fact: an unedited form claimed every
    // donation contained dairy and wheat, whatever was actually in the food.
    expect(screen.getByLabelText(/allergen/i)).toHaveValue("");
    expect(screen.getByLabelText(/handling notes/i)).toHaveValue("");
    expect(screen.getByLabelText(/allergen/i)).toHaveAttribute(
      "placeholder",
      expect.stringMatching(/^e\.g\./),
    );
  });

  it("will not post without a stated allergen answer", async () => {
    const user = await openDialog();
    createDonation.mockClear();

    await user.type(screen.getByLabelText(/what is available/i), "Hot line meals");
    await user.type(screen.getByLabelText(/pickup address/i), "400 E Locust St");
    await user.click(screen.getByRole("button", { name: /post and find matches/i }));

    expect(createDonation).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/allergen/i)).toBeRequired();
  });
});
