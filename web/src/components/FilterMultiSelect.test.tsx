import { describe, expect, test } from "vitest";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "../test/render";
import FilterMultiSelect from "./FilterMultiSelect";

const DATA = [
  { value: "a", label: "Alpha" },
  { value: "z", label: "Żółw" },
  { value: "c", label: "Charlie" },
];

function Harness({ seen }: { seen?: string[][] }) {
  const [value, setValue] = useState<string[]>([]);
  return (
    <FilterMultiSelect
      label="Things"
      data={DATA}
      value={value}
      onChange={(next) => {
        seen?.push(next);
        setValue(next);
      }}
    />
  );
}

describe("FilterMultiSelect", () => {
  test("empty selection reads All; picks accumulate in order and the dropdown stays open", async () => {
    const user = userEvent.setup();
    const seen: string[][] = [];
    renderWithProviders(<Harness seen={seen} />);

    const field = screen.getByRole("combobox", { name: "Things" });
    expect(field).toHaveAttribute("placeholder", "All");
    await user.click(field);
    await user.click(await screen.findByRole("option", { name: "Charlie" }));
    await user.click(screen.getByRole("option", { name: "Alpha" }));
    expect(seen).toEqual([["c"], ["c", "a"]]);
    // With picks the "All" placeholder is gone.
    expect(screen.getByRole("combobox", { name: "Things" })).not.toHaveAttribute("placeholder", "All");
  });

  test("each pill has a named, focusable remove button that removes only that value", async () => {
    const user = userEvent.setup();
    const seen: string[][] = [];
    renderWithProviders(<Harness seen={seen} />);

    await user.click(screen.getByRole("combobox", { name: "Things" }));
    await user.click(await screen.findByRole("option", { name: "Alpha" }));
    await user.click(screen.getByRole("option", { name: "Charlie" }));
    await user.click(screen.getByRole("button", { name: "Remove Alpha" }));
    expect(seen.at(-1)).toEqual(["c"]);
  });

  test("search folds accents (the theme-level foldedOptionsFilter)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);

    const field = screen.getByRole("combobox", { name: "Things" });
    await user.click(field);
    await user.type(field, "zolw");
    expect(await screen.findByRole("option", { name: "Żółw" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Alpha", hidden: false })).toBeNull();
  });

  test("a selected value absent from data renders a pill with the raw value instead of crashing", async () => {
    // Mantine hands renderPill `option: undefined` for such a value (a stored pick whose options
    // load late, or were deleted) — the accessible pill must fall back to the value itself.
    renderWithProviders(
      <FilterMultiSelect label="Things" data={DATA} value={["ghost"]} onChange={() => undefined} />,
    );
    expect(screen.getByRole("button", { name: "Remove ghost" })).toBeInTheDocument();
  });

  test("a pick whose option arrives later switches from the raw value to the option label", async () => {
    function Late() {
      const [data, setData] = useState<{ value: string; label: string }[]>([]);
      return (
        <>
          <button onClick={() => setData(DATA)}>load</button>
          <FilterMultiSelect label="Things" data={data} value={["a"]} onChange={() => undefined} />
        </>
      );
    }
    const user = userEvent.setup();
    renderWithProviders(<Late />);
    expect(screen.getByRole("button", { name: "Remove a" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "load" }));
    expect(screen.getByRole("button", { name: "Remove Alpha" })).toBeInTheDocument();
    expect(within(document.body).queryByRole("button", { name: "Remove a" })).toBeNull();
  });
});
