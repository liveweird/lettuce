import { describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { IconMessageCircle, IconPencil, IconTrash } from "@tabler/icons-react";
import { renderWithProviders, screen } from "../test/render";
import RowActions from "./RowActions";

describe("RowActions", () => {
  test("the primary action renders as a named link when it has a target", () => {
    renderWithProviders(
      <RowActions
        name="Alice"
        primary={{ icon: <IconPencil />, label: "Edit", ariaLabel: "Edit Alice", to: "/users/1/edit" }}
      />,
    );
    const link = screen.getByRole("link", { name: "Edit Alice" });
    expect(link).toHaveAttribute("href", "/users/1/edit");
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("the ⋯ menu is named after the row subject and holds the overflow items (links keep hrefs)", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderWithProviders(
      <RowActions
        name="Alice"
        primary={{ icon: <IconPencil />, label: "Edit", to: "/edit", ariaLabel: "Edit Alice" }}
        items={[
          { label: "Change password", to: "/password", ariaLabel: "Change password for Alice" },
          { label: "Delete", ariaLabel: "Delete Alice", icon: <IconTrash />, color: "red", onClick: onDelete, dividerBefore: true },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "More actions for Alice" }));
    expect(screen.getByRole("menuitem", { name: "Change password for Alice" })).toHaveAttribute("href", "/password");
    await user.click(screen.getByRole("menuitem", { name: "Delete Alice" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  test("menuLabel overrides the ⋯ trigger name and named menus keep their own", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RowActions
        name="Alice"
        menuLabel="Modify actions for Alice"
        menus={[
          {
            label: "Feedback actions for Alice",
            icon: <IconMessageCircle />,
            items: [{ label: "Provide feedback", ariaLabel: "Provide feedback for Alice", to: "/feedback/new" }],
          },
        ]}
        items={[{ label: "Deactivate", ariaLabel: "Deactivate Alice", onClick: vi.fn() }]}
      />,
    );
    expect(screen.getByRole("button", { name: "Modify actions for Alice" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Feedback actions for Alice" }));
    expect(screen.getByRole("menuitem", { name: "Provide feedback for Alice" })).toHaveAttribute("href", "/feedback/new");
  });

  test("a disabled primary renders without a tooltip and stays disabled", () => {
    renderWithProviders(
      <RowActions name="Alice" primary={{ icon: <IconPencil />, label: "Accept", onClick: vi.fn(), disabled: true }} />,
    );
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
  });
});
