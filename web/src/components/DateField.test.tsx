import { describe, expect, test, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render";
import DateField from "./DateField";
import { isOutsideIsoRange } from "../utils/isoRange";

describe("DateField", () => {
  test("renders the ISO value in a labelled textbox with the ISO placeholder", () => {
    renderWithProviders(<DateField label="Due date" value="2026-07-01" onChange={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "Due date" });
    expect(input).toHaveValue("2026-07-01");
    expect(input).toHaveAttribute("placeholder", "YYYY-MM-DD");
    // The clear button carries a name (the axe button-name rule).
    expect(screen.getByRole("button", { name: "Clear the date" })).toBeInTheDocument();
  });

  test("a typed ISO date reaches onChange as the same string; clearing yields an empty string", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<DateField label="Due date" value="" onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "Due date" });
    expect(input).toHaveValue("");
    await user.type(input, "2026-07-15");
    expect(onChange).toHaveBeenLastCalledWith("2026-07-15");
    // The fireEvent.change shape the older tests use keeps working (parse on change).
    fireEvent.change(input, { target: { value: "2027-01-02" } });
    expect(onChange).toHaveBeenLastCalledWith("2027-01-02");
    await user.clear(input);
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  test("minIso/maxIso are calendar hints only — a typed out-of-range date still reaches the form", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <DateField label="Start" value="" onChange={onChange} minIso="2026-01-01" maxIso="2026-12-31" />,
    );
    await user.type(screen.getByRole("textbox", { name: "Start" }), "2025-06-01");
    expect(onChange).toHaveBeenLastCalledWith("2025-06-01");
    expect(isOutsideIsoRange("2025-06-01", "2026-01-01", "2026-12-31")).toBe(true);
    expect(isOutsideIsoRange("2026-06-01", "2026-01-01", "2026-12-31")).toBe(false);
    expect(isOutsideIsoRange("2027-01-01", "2026-01-01", "")).toBe(false);
  });
});
