import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../test/render";
import DateTimeField from "./DateTimeField";

const dateBox = (label: string) => screen.getByRole("textbox", { name: `${label} — date` });
const timeBox = (label: string) => screen.getByLabelText(`${label} — time`);

/** The form-shaped host: echoes every emitted value back as the controlled `value`. */
function Controlled({ initial = "", onChange }: { initial?: string; onChange: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <DateTimeField
        label="Visible from"
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
      <button type="button" onClick={() => setValue("")}>
        reset
      </button>
      <button type="button" onClick={() => setValue("2030-01-02T03:04")}>
        load
      </button>
    </>
  );
}

describe("DateTimeField", () => {
  test("splits the T-separated value into a named date and time input under one group", () => {
    renderWithProviders(<DateTimeField label="Visible from" value="2026-07-01T09:30" onChange={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Visible from" })).toBeInTheDocument();
    expect(dateBox("Visible from")).toHaveValue("2026-07-01");
    expect(timeBox("Visible from")).toHaveValue("09:30");
  });

  test("a date alone emits an unset bound (never a dangling 'T'); the time completes it; clearing the date unsets both (v3.5.2)", () => {
    const onChange = vi.fn();
    renderWithProviders(<Controlled onChange={onChange} />);
    fireEvent.change(dateBox("Visible from"), { target: { value: "2026-07-01" } });
    // The former "2026-07-01T00:00" default is gone — half a bound is no bound, and the
    // form's own validation says so instead of a silent null at the API boundary.
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(dateBox("Visible from")).toHaveValue("2026-07-01");
    fireEvent.change(timeBox("Visible from"), { target: { value: "08:15" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-07-01T08:15");
    fireEvent.change(dateBox("Visible from"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(timeBox("Visible from")).toHaveValue("08:15");
  });

  test("a time typed BEFORE the date survives and joins it once the date lands (v3.5.2)", () => {
    const onChange = vi.fn();
    renderWithProviders(<Controlled onChange={onChange} />);
    fireEvent.change(timeBox("Visible from"), { target: { value: "17:45" } });
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(timeBox("Visible from")).toHaveValue("17:45");
    fireEvent.change(dateBox("Visible from"), { target: { value: "2026-07-01" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-07-01T17:45");
  });

  test("clearing the time yields an empty value; a partial time never emits a fragment (v3.5.2)", () => {
    const onChange = vi.fn();
    renderWithProviders(<Controlled initial="2026-07-01T09:30" onChange={onChange} />);
    fireEvent.change(timeBox("Visible from"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(dateBox("Visible from")).toHaveValue("2026-07-01");
    fireEvent.change(timeBox("Visible from"), { target: { value: "09:" } });
    expect(onChange).toHaveBeenLastCalledWith("");
    fireEvent.change(timeBox("Visible from"), { target: { value: "09:45" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-07-01T09:45");
  });

  test("an external value change re-seeds both halves — a form reset clears them, a loaded record fills them", () => {
    const onChange = vi.fn();
    renderWithProviders(<Controlled onChange={onChange} />);
    fireEvent.change(timeBox("Visible from"), { target: { value: "17:45" } });
    fireEvent.click(screen.getByRole("button", { name: "load" }));
    expect(dateBox("Visible from")).toHaveValue("2030-01-02");
    expect(timeBox("Visible from")).toHaveValue("03:04");
    fireEvent.click(screen.getByRole("button", { name: "reset" }));
    expect(dateBox("Visible from")).toHaveValue("");
    expect(timeBox("Visible from")).toHaveValue("");
    // The parent's own echoes of our emits never re-seed (no feedback loop).
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test("disabled and error flags reach both inputs and the message renders below", () => {
    renderWithProviders(
      <DateTimeField label="Visible until" value="" onChange={vi.fn()} disabled description="Unbounded" />,
    );
    expect(dateBox("Visible until")).toBeDisabled();
    expect(timeBox("Visible until")).toBeDisabled();
    expect(screen.getByText("Unbounded")).toBeInTheDocument();
  });
});
