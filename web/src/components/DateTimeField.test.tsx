import { describe, expect, test, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../test/render";
import DateTimeField from "./DateTimeField";

describe("DateTimeField", () => {
  test("splits the T-separated value into a named date and time input under one group", () => {
    renderWithProviders(<DateTimeField label="Visible from" value="2026-07-01T09:30" onChange={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Visible from" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Visible from — date" })).toHaveValue("2026-07-01");
    expect(screen.getByLabelText("Visible from — time")).toHaveValue("09:30");
  });

  test("a typed date defaults the time to midnight, a typed time joins the date, clearing the date unsets both", () => {
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(<DateTimeField label="Visible from" value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Visible from — date" }), { target: { value: "2026-07-01" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-07-01T00:00");
    rerender(<DateTimeField label="Visible from" value="2026-07-01T00:00" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Visible from — time"), { target: { value: "08:15" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-07-01T08:15");
    fireEvent.change(screen.getByRole("textbox", { name: "Visible from — date" }), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  test("disabled and error flags reach both inputs and the message renders below", () => {
    renderWithProviders(
      <DateTimeField label="Visible until" value="" onChange={vi.fn()} disabled description="Unbounded" />,
    );
    expect(screen.getByRole("textbox", { name: "Visible until — date" })).toBeDisabled();
    expect(screen.getByLabelText("Visible until — time")).toBeDisabled();
    expect(screen.getByText("Unbounded")).toBeInTheDocument();
  });
});
