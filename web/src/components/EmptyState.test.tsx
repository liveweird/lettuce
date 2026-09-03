import { describe, expect, test } from "vitest";
import { Button } from "@mantine/core";
import { IconConfetti } from "@tabler/icons-react";
import { renderWithProviders, screen } from "../test/render";
import EmptyState from "./EmptyState";

describe("EmptyState", () => {
  test("renders the label alone by default", () => {
    renderWithProviders(<EmptyState icon={<IconConfetti />} label="No kudos yet" />);
    expect(screen.getByText("No kudos yet")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("renders the optional description and call to action", () => {
    renderWithProviders(
      <EmptyState
        icon={<IconConfetti />}
        label="No goals yet"
        description="Goals appear here once a manager sets one."
        action={<Button>Create your first goal</Button>}
      />,
    );
    expect(screen.getByText("Goals appear here once a manager sets one.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create your first goal" })).toBeInTheDocument();
  });
});
