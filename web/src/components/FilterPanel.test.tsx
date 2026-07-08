import { afterEach, describe, expect, test } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, within } from "../test/render";
import { TextInput } from "@mantine/core";
import FilterPanel from "./FilterPanel";

describe("FilterPanel", () => {
  afterEach(() => {
    localStorage.clear();
  });

  test("is collapsed by default and the toggle reveals / hides the children", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <FilterPanel activeFilterCount={0} storageKey="test">
        <TextInput label="Name" />
      </FilterPanel>,
    );

    const toggle = screen.getByRole("button", { name: /filters/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Name")).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  test("shows the active-filter count badge only when there are active filters", () => {
    const { rerender } = renderWithProviders(
      <FilterPanel activeFilterCount={0} storageKey="test">
        <TextInput label="Name" />
      </FilterPanel>,
    );

    const toggle = screen.getByRole("button", { name: /filters/i });
    expect(within(toggle).queryByText("2")).not.toBeInTheDocument();

    rerender(
      <FilterPanel activeFilterCount={2} storageKey="test">
        <TextInput label="Name" />
      </FilterPanel>,
    );
    expect(within(toggle).getByText("2")).toBeInTheDocument();
  });

  test("restores a persisted open state on mount", () => {
    localStorage.setItem("lettuce.viewSettings.test.filtersOpen", "true");
    renderWithProviders(
      <FilterPanel activeFilterCount={0} storageKey="test">
        <TextInput label="Name" />
      </FilterPanel>,
    );

    expect(screen.getByRole("button", { name: /filters/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });
});
