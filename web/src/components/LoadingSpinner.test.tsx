import { describe, expect, test } from "vitest";
import { renderWithProviders, screen } from "../test/render";
import ResponsiveTable from "./ResponsiveTable";
import CenteredLoader from "./CenteredLoader";
import LoadingSpinner from "./LoadingSpinner";
import TableLoadingRow from "./TableLoadingRow";

describe("LoadingSpinner", () => {
  test("is an indeterminate progressbar named Loading…", () => {
    renderWithProviders(<LoadingSpinner size="sm" />);
    const spinner = screen.getByRole("progressbar", { name: "Loading…" });
    // Indeterminate: no value.
    expect(spinner).not.toHaveAttribute("aria-valuenow");
  });

  test("a caller's aria-label replaces the name; aria-hidden removes it from the tree", () => {
    renderWithProviders(
      <>
        <LoadingSpinner aria-label="Saving…" />
        <LoadingSpinner aria-hidden />
      </>,
    );
    expect(screen.getByRole("progressbar", { name: "Saving…" })).toBeInTheDocument();
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
  });

  test("CenteredLoader exposes the progressbar", () => {
    renderWithProviders(<CenteredLoader />);
    expect(screen.getByRole("progressbar", { name: "Loading…" })).toBeInTheDocument();
  });

  test("TableLoadingRow exposes the progressbar", () => {
    renderWithProviders(
      <ResponsiveTable>
        <ResponsiveTable.Tbody>
          <TableLoadingRow colSpan={3} />
        </ResponsiveTable.Tbody>
      </ResponsiveTable>,
    );
    expect(screen.getByRole("progressbar", { name: "Loading…" })).toBeInTheDocument();
  });
});
