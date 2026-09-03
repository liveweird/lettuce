import { describe, expect, test, vi } from "vitest";
import { renderWithProviders, screen } from "../test/render";
import PaginationBar from "./PaginationBar";

describe("PaginationBar", () => {
  test("the full form renders the total, the rows-per-page picker, and named pager arrows", () => {
    renderWithProviders(
      <PaginationBar
        total={45}
        page={1}
        pageSize={20}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
        rowsPerPageLabelKey="users.rowsPerPage"
      />,
    );
    expect(screen.getByText("45 total")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Rows per page" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3" })).toBeInTheDocument();
  });

  test("the compact form (no page-size handler) hides the picker but keeps the pager", () => {
    renderWithProviders(<PaginationBar total={120} page={2} pageSize={50} onPageChange={vi.fn()} />);
    expect(screen.getByText("120 total")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeInTheDocument();
  });
});
