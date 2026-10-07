import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const suggestAddresses = vi.fn();
vi.mock("@/lib/address-suggest", () => ({
  suggestAddresses: (...args: unknown[]) => suggestAddresses(...args),
  MIN_QUERY_LENGTH: 4,
}));

import { AddressInput } from "@/components/rescuerelay/address-input";

const LOCUST = {
  value: "400, East Locust Street, Des Moines, Iowa, 50309",
  primary: "400 East Locust Street",
  secondary: "Des Moines, Iowa, 50309",
};
const SEVENTEENTH = {
  value: "2220, East 17th Street, Des Moines, Iowa, 50316",
  primary: "2220 East 17th Street",
  secondary: "Des Moines, Iowa, 50316",
};

function Harness() {
  const [value, setValue] = useState("");
  return (
    <AddressInput
      id="address"
      name="address"
      value={value}
      onValueChange={setValue}
      placeholder="Start typing"
    />
  );
}

afterEach(() => {
  suggestAddresses.mockReset();
});

describe("Address autocomplete", () => {
  it("suggests addresses as the donor types", async () => {
    suggestAddresses.mockResolvedValue([LOCUST, SEVENTEENTH]);
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole("combobox"), "400 e locust");

    expect(await screen.findByText("400 East Locust Street")).toBeInTheDocument();
    expect(screen.getByText("Des Moines, Iowa, 50309")).toBeInTheDocument();
  });

  it("fills the field with the chosen address", async () => {
    suggestAddresses.mockResolvedValue([LOCUST]);
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole("combobox"), "400 e locust");
    await user.click(await screen.findByRole("option", { name: /400 East Locust Street/ }));

    expect(screen.getByRole("combobox")).toHaveValue(LOCUST.value);
  });

  it("does not re-query after a suggestion is taken", async () => {
    suggestAddresses.mockResolvedValue([LOCUST]);
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole("combobox"), "400 e locust");
    await user.click(await screen.findByRole("option", { name: /400 East Locust Street/ }));
    const callsAfterChoosing = suggestAddresses.mock.calls.length;

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(suggestAddresses.mock.calls.length).toBe(callsAfterChoosing);
  });

  it("is navigable by keyboard", async () => {
    suggestAddresses.mockResolvedValue([LOCUST, SEVENTEENTH]);
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole("combobox"), "des moines");
    await screen.findByRole("option", { name: /400 East Locust Street/ });

    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(screen.getByRole("combobox")).toHaveValue(SEVENTEENTH.value);
  });

  it("dismisses the list on Escape", async () => {
    suggestAddresses.mockResolvedValue([LOCUST]);
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole("combobox"), "400 e locust");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  it("debounces, so a fast typist does not issue a request per keystroke", async () => {
    suggestAddresses.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole("combobox"), "400 east locust street");
    await waitFor(() => expect(suggestAddresses).toHaveBeenCalled());

    expect(suggestAddresses.mock.calls.length).toBeLessThan(5);
  });

  it("stays usable when the service returns nothing", async () => {
    suggestAddresses.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole("combobox"), "somewhere unknown");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("somewhere unknown");
  });

  it("reports its state to assistive technology", async () => {
    suggestAddresses.mockResolvedValue([LOCUST]);
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("combobox");

    expect(input).toHaveAttribute("aria-expanded", "false");
    await user.type(input, "400 e locust");
    await screen.findByRole("listbox");

    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toHaveAccessibleName("Address suggestions");
  });
});
