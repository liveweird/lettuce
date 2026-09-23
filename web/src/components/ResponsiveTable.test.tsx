import { describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, within } from "../test/render";
import ResponsiveTable from "./ResponsiveTable";
import SortHeader from "./SortHeader";
import TableLoadingRow from "./TableLoadingRow";

describe("ResponsiveTable", () => {
  test("preserves a single semantic table, its sorting callback and row action", async () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ResponsiveTable density="wide" aria-label="Feedback">
        <ResponsiveTable.Thead>
          <ResponsiveTable.Tr>
            <ResponsiveTable.Th sortable>
              <SortHeader field="name" label="Name" activeField="name" activeDir="asc" onToggle={onToggle} />
            </ResponsiveTable.Th>
            <ResponsiveTable.Th actions aria-label="Actions" />
          </ResponsiveTable.Tr>
        </ResponsiveTable.Thead>
        <ResponsiveTable.Tbody>
          <ResponsiveTable.Tr>
            <ResponsiveTable.Td label="Name" primary>Aleksandra Kowalska</ResponsiveTable.Td>
            <ResponsiveTable.Td label="Actions" actions><a href="/feedback/1/view">View feedback</a></ResponsiveTable.Td>
          </ResponsiveTable.Tr>
        </ResponsiveTable.Tbody>
      </ResponsiveTable>,
    );
    const table = screen.getByRole("table", { name: "Feedback" });
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(within(table).getAllByRole("columnheader")).toHaveLength(2);
    expect(within(table).getAllByRole("cell")).toHaveLength(2);
    expect(screen.getAllByText("Aleksandra Kowalska")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "View feedback" })).toHaveAttribute("href", "/feedback/1/view");
    await userEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(onToggle).toHaveBeenCalledExactlyOnceWith("name");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  test("keeps spanning loading and empty states in the table", () => {
    renderWithProviders(
      <ResponsiveTable>
        <ResponsiveTable.Tbody>
          <TableLoadingRow colSpan={4} />
          <ResponsiveTable.Tr><ResponsiveTable.Td colSpan={4}>No records</ResponsiveTable.Td></ResponsiveTable.Tr>
        </ResponsiveTable.Tbody>
      </ResponsiveTable>,
    );
    const cells = screen.getAllByRole("cell");
    expect(cells).toHaveLength(2);
    for (const cell of cells) expect(cell).toHaveAttribute("colspan", "4");
    expect(screen.getByText("No records")).toBeInTheDocument();
  });

  test("provides a keyboard focusable named region for comparison tables", () => {
    renderWithProviders(
      <ResponsiveTable mode="matrix" minWidth={1100}>
        <ResponsiveTable.Tbody><ResponsiveTable.Tr><ResponsiveTable.Td>Comparison</ResponsiveTable.Td></ResponsiveTable.Tr></ResponsiveTable.Tbody>
      </ResponsiveTable>,
    );
    expect(screen.getByRole("region", { name: "Scrollable table" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  test("Th vertical emits data-vertical", () => {
    renderWithProviders(
      <ResponsiveTable>
        <ResponsiveTable.Thead>
          <ResponsiveTable.Tr>
            <ResponsiveTable.Th sortable vertical>Overall</ResponsiveTable.Th>
          </ResponsiveTable.Tr>
        </ResponsiveTable.Thead>
      </ResponsiveTable>,
    );
    expect(screen.getByRole("columnheader")).toHaveAttribute("data-vertical");
  });

  test("Th width emits data-width for each value and is absent by default", () => {
    renderWithProviders(
      <ResponsiveTable>
        <ResponsiveTable.Thead>
          <ResponsiveTable.Tr>
            <ResponsiveTable.Th width="narrow">Line</ResponsiveTable.Th>
            <ResponsiveTable.Th width="wide">Password</ResponsiveTable.Th>
            <ResponsiveTable.Th>Name</ResponsiveTable.Th>
          </ResponsiveTable.Tr>
        </ResponsiveTable.Thead>
      </ResponsiveTable>,
    );
    const headers = screen.getAllByRole("columnheader");
    expect(headers[0]).toHaveAttribute("data-width", "narrow");
    expect(headers[1]).toHaveAttribute("data-width", "wide");
    expect(headers[2]).not.toHaveAttribute("data-width");
  });

  test("the matrix scroll hint stays hidden when the viewport does not actually overflow", () => {
    // happy-dom reports scrollWidth/clientWidth as 0/0 by default — never overflowing — so the
    // hint (and data-overflowing) must not render even though mode is "matrix".
    renderWithProviders(
      <ResponsiveTable mode="matrix" minWidth={1100}>
        <ResponsiveTable.Tbody><ResponsiveTable.Tr><ResponsiveTable.Td>Comparison</ResponsiveTable.Td></ResponsiveTable.Tr></ResponsiveTable.Tbody>
      </ResponsiveTable>,
    );
    expect(screen.queryByText("Scroll horizontally to see all columns.")).not.toBeInTheDocument();
    expect(screen.getByRole("region").closest("[data-mode]")).not.toHaveAttribute("data-overflowing");
  });

  test("the matrix scroll hint shows once the viewport actually overflows", () => {
    // Override the geometry getters at the prototype level BEFORE mount, so the component's
    // mount-time overflow check (the ResizeObserver-less happy-dom fallback) reads them.
    const scrollWidthDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollWidth");
    const clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(Element.prototype, "scrollWidth", { configurable: true, value: 2000 });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 500 });
    try {
      renderWithProviders(
        <ResponsiveTable mode="matrix" minWidth={1100}>
          <ResponsiveTable.Tbody><ResponsiveTable.Tr><ResponsiveTable.Td>Comparison</ResponsiveTable.Td></ResponsiveTable.Tr></ResponsiveTable.Tbody>
        </ResponsiveTable>,
      );
      expect(screen.getByText("Scroll horizontally to see all columns.")).toBeInTheDocument();
      expect(screen.getByRole("region").closest("[data-mode]")).toHaveAttribute("data-overflowing", "true");
    } finally {
      if (scrollWidthDescriptor) Object.defineProperty(Element.prototype, "scrollWidth", scrollWidthDescriptor);
      if (clientWidthDescriptor) Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidthDescriptor);
    }
  });
});
