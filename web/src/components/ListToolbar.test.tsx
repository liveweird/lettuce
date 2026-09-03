import { afterEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { TextInput } from "@mantine/core";
import { renderWithProviders, screen } from "../test/render";
import ListToolbar from "./ListToolbar";

describe("ListToolbar", () => {
  afterEach(() => {
    localStorage.clear();
  });

  test("the quick search is named by its label and the Filters toggle reveals the panel", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <ListToolbar
        search={{ label: "Name", value: "", onChange, clearLabel: "Clear the name filter" }}
        filters={{ activeCount: 0, storageKey: "test", children: <TextInput label="Role" /> }}
      />,
    );
    const search = screen.getByRole("textbox", { name: "Name" });
    await user.type(search, "a");
    expect(onChange).toHaveBeenCalledWith("a");

    const toggle = screen.getByRole("button", { name: /filters/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Role")).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Role")).toBeInTheDocument();
    expect(localStorage.getItem("lettuce.viewSettings.test.filtersOpen")).toBe("true");
  });

  test("Clear filters appears only while filters are active and calls back", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    const { rerender } = renderWithProviders(
      <ListToolbar filters={{ activeCount: 0, storageKey: "test", onClear, children: <TextInput label="Email" /> }} />,
    );
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    rerender(
      <ListToolbar filters={{ activeCount: 2, storageKey: "test", onClear, children: <TextInput label="Email" /> }} />,
    );
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  test("renders the right-hand slot", () => {
    renderWithProviders(<ListToolbar right={<TextInput aria-label="Sort by" />} />);
    expect(screen.getByRole("textbox", { name: "Sort by" })).toBeInTheDocument();
  });
});
