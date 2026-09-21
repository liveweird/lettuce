import { describe, expect, test } from "vitest";
import { Badge } from "@mantine/core";
import { renderWithProviders, screen } from "../test/render";
import RatingBadge, { RatingCells } from "./RatingBadge";
import ResponsiveTable from "./ResponsiveTable";

describe("RatingBadge", () => {
  test("inside a table cell the atomic pill keeps its width while a plain badge is squeezed", () => {
    // The v3.25.1 bug, reproduced in miniature. The cell stylesheet carries
    // `min-width: 0 !important` for badges, which BEATS a component's own inline
    // `min-width` — so a one-digit pill in a narrow rating column collapsed and Mantine's
    // `overflow: hidden` label silently ate the digit. `data-atomic` is what exempts the
    // rating pill from that rule, so the guard is the CONTRAST: same inline style, same
    // cell, different outcome. Remove the exemption from the CSS module and the first
    // expectation drops to "0px".
    renderWithProviders(
      <ResponsiveTable>
        <ResponsiveTable.Tbody>
          <ResponsiveTable.Tr>
            <ResponsiveTable.Td label="Overall" numeric>
              <RatingBadge rating={4} />
            </ResponsiveTable.Td>
            <ResponsiveTable.Td label="Status">
              <Badge style={{ minWidth: "max-content" }}>Published</Badge>
            </ResponsiveTable.Td>
          </ResponsiveTable.Tr>
        </ResponsiveTable.Tbody>
      </ResponsiveTable>,
    );
    const pill = screen.getByText("4").closest("[data-atomic]") as HTMLElement;
    expect(pill).not.toBeNull();
    expect(getComputedStyle(pill).minWidth).toBe("max-content");
    // The same inline style on an ordinary badge loses to the cell rule — which is why the
    // pill needs the marker rather than an inline width of its own.
    const plain = screen.getByText("Published").closest(".mantine-Badge-root") as HTMLElement;
    expect(getComputedStyle(plain).minWidth).toBe("0");
  });

  test("RatingCells renders a pill per set rating and a dimmed dash for an unset one", () => {
    renderWithProviders(
      <ResponsiveTable>
        <ResponsiveTable.Tbody>
          <ResponsiveTable.Tr>
            <RatingCells ratings={[5, null]} labels={["Attitude", "Delivery"]} />
          </ResponsiveTable.Tr>
        </ResponsiveTable.Tbody>
      </ResponsiveTable>,
    );
    expect(screen.getByText("5")).toBeInTheDocument();
    // An unset rating is a dash, never a coloured box — the symptom that ruled out the
    // "missing data" diagnosis when the empty pills were reported.
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  test("`numeric` is opt-in per table: only then does the cell take the tight padding", () => {
    // Shared by both performance tables: the rotated-header table passes it, the plain-header
    // one must not (its data would sit 4px off its own headings).
    const { container: tight } = renderWithProviders(
      <ResponsiveTable>
        <ResponsiveTable.Tbody>
          <ResponsiveTable.Tr>
            <RatingCells ratings={[3]} labels={["Overall"]} numeric />
          </ResponsiveTable.Tr>
        </ResponsiveTable.Tbody>
      </ResponsiveTable>,
    );
    expect(tight.querySelector("td[data-numeric]")).not.toBeNull();

    const { container: plain } = renderWithProviders(
      <ResponsiveTable>
        <ResponsiveTable.Tbody>
          <ResponsiveTable.Tr>
            <RatingCells ratings={[3]} labels={["Overall"]} />
          </ResponsiveTable.Tr>
        </ResponsiveTable.Tbody>
      </ResponsiveTable>,
    );
    expect(plain.querySelector("td[data-numeric]")).toBeNull();
  });
});
