import { describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import SortHeader from "./SortHeader";
import { renderWithProviders, screen } from "../test/render";

describe("SortHeader", () => {
  test("renders the label and calls onToggle with its field when clicked", async () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <SortHeader
        field="name"
        label="Name"
        activeField="other"
        activeDir="asc"
        onToggle={onToggle}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /name/i }));
    expect(onToggle).toHaveBeenCalledExactlyOnceWith("name");
  });

  test("shows the ascending arrow when active and ascending", () => {
    const { container } = renderWithProviders(
      <SortHeader field="name" label="Name" activeField="name" activeDir="asc" onToggle={() => {}} />,
    );
    expect(container.querySelector(".tabler-icon-arrow-up")).not.toBeNull();
    expect(container.querySelector(".tabler-icon-arrow-down")).toBeNull();
  });

  test("shows the descending arrow when active and descending", () => {
    const { container } = renderWithProviders(
      <SortHeader field="name" label="Name" activeField="name" activeDir="desc" onToggle={() => {}} />,
    );
    expect(container.querySelector(".tabler-icon-arrow-down")).not.toBeNull();
    expect(container.querySelector(".tabler-icon-arrow-up")).toBeNull();
  });

  test("shows the neutral sort icon when not the active field", () => {
    const { container } = renderWithProviders(
      <SortHeader field="name" label="Name" activeField="email" activeDir="asc" onToggle={() => {}} />,
    );
    expect(container.querySelector(".tabler-icon-arrows-sort")).not.toBeNull();
  });
});
