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

  test("the calendar greys out the days outside [minIso, maxIso] (the excludeDate wiring)", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DateField label="Start" value="" onChange={vi.fn()} minIso="2026-01-10" maxIso="2026-01-20" defaultDate="2026-01-01" />,
    );
    await user.click(screen.getByRole("textbox", { name: "Start" }));
    // Day buttons are named "D MMMM YYYY" by Mantine; an excluded day renders disabled.
    expect(await screen.findByRole("button", { name: "5 January 2026" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "25 January 2026" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "15 January 2026" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "10 January 2026" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "20 January 2026" })).toBeEnabled();
  });

  test("a partial keystroke never commits — only a complete ISO date reaches onChange (v3.5.2)", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<DateField label="Due date" value="" onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "Due date" });
    // Mantine's default lenient parser would have committed "2" as 2001-02-01 and "2026-0"
    // as 2025-12-01 on the way to the full date.
    await user.type(input, "2026-0");
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue("2026-0");
    await user.type(input, "7-15");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("2026-07-15");
  });

  test("an overflow date (Feb 30th) never commits instead of rolling over to March (v3.5.2)", async () => {
    const onChange = vi.fn();
    renderWithProviders(<DateField label="Due date" value="" onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "Due date" });
    fireEvent.change(input, { target: { value: "2026-02-30" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "2026-13-01" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "2026-02-28" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-02-28");
  });
});
