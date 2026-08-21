import { describe, expect, test, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { UseMutationResult } from "@tanstack/react-query";
import { renderWithProviders } from "../test/render";
import { ApiError } from "../api/http";
import type { DeleteConfirm } from "../hooks/useDeleteConfirm";
import ConfirmDeleteModal from "./ConfirmDeleteModal";

// The v2.22.0 message rule pinned at the shared component: a failed delete never renders
// the transport's raw `error.message` ("API 500" / "Failed to fetch") — the default branch
// maps through saveErrorMessage onto the generic action wording.
function confirmWithError(error: Error): DeleteConfirm<string> {
  return {
    target: "Row",
    opened: true,
    requestDelete: vi.fn(),
    cancelDelete: vi.fn(),
    confirmDelete: vi.fn(),
    mutation: { isError: true, error, isPending: false } as unknown as UseMutationResult<
      unknown,
      Error,
      string
    >,
  };
}

function renderModal(confirm: DeleteConfirm<string>, errorMessage?: (error: unknown) => string) {
  renderWithProviders(
    <ConfirmDeleteModal
      confirm={confirm}
      title="Delete this?"
      errorTitle="Delete failed"
      body={(t) => `About to delete ${t}`}
      errorMessage={errorMessage}
    />,
  );
}

describe("ConfirmDeleteModal error wording", () => {
  test("an unmatched API status renders the generic action wording with the status, never error.message", () => {
    renderModal(confirmWithError(new ApiError(500, null)));
    expect(screen.getByText("The action failed (HTTP 500).")).toBeInTheDocument();
    expect(screen.queryByText("API 500")).toBeNull();
  });

  test("a network failure renders the generic action wording, never the browser message", () => {
    renderModal(confirmWithError(new TypeError("Failed to fetch")));
    expect(screen.getByText("The action failed. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  });

  test("a page-supplied errorMessage mapper still wins over the default", () => {
    renderModal(confirmWithError(new ApiError(409, null)), () => "This row is still referenced.");
    expect(screen.getByText("This row is still referenced.")).toBeInTheDocument();
  });
});
