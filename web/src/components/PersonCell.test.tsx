import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import PersonCell from "./PersonCell";

function renderCell(props: Parameters<typeof PersonCell>[0]) {
  return render(
    <MantineProvider env="test">
      <MemoryRouter>
        <PersonCell {...props} />
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe("PersonCell", () => {
  test("links an identifiable other person's name to their user-details view (v2.30.0)", () => {
    renderCell({ userId: 10, name: "Alice", currentUserId: 7 });
    const link = screen.getByRole("link", { name: "User details for Alice" });
    expect(link).toHaveAttribute("href", "/users/10/details?name=Alice");
    expect(link).toHaveTextContent("Alice");
  });

  test("renders the current user as plain 'You' with no link", () => {
    renderCell({ userId: 7, name: "Alice", currentUserId: 7 });
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  test("renders a deleted user as plain suffixed text with no link", () => {
    renderCell({ userId: 10, name: "Alice", deleted: true, currentUserId: 7 });
    expect(screen.getByText("Alice (deleted)")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  test("renders an absent party as a plain dash with no link", () => {
    renderCell({ userId: null, name: null, currentUserId: 7 });
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
